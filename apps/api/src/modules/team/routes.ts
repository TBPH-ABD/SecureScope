import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { canAssignRole, outranks } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { mailer } from "../../integrations/mailer.js";
import { audit } from "../../lib/audit.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { prisma } from "../../lib/db.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { parse, uuidParam } from "../../lib/validation.js";

const role = z.enum(["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"]);
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role });
const roleSchema = z.object({ role });

export async function teamRoutes(app: FastifyInstance) {
  app.get("/team", { preHandler: requireAuth("team:read") }, async (req) => {
    const auth = getAuth(req);
    const members = await prisma.membership.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    });
    const canManage = auth.role === "OWNER" || auth.role === "SECURITY_ADMIN";
    const invitations = canManage
      ? await prisma.invitation.findMany({
          where: { organizationId: auth.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        })
      : [];
    return {
      members: members.map((m) => ({ id: m.id, role: m.role, joinedAt: m.createdAt, user: m.user, isSelf: m.userId === auth.user.id })),
      invitations,
      emailDelivery: mailer.configured,
    };
  });

  app.post("/team/invitations", { preHandler: requireAuth("team:manage") }, async (req, reply) => {
    const auth = getAuth(req);
    const body = parse(inviteSchema, req.body);
    if (!canAssignRole(auth.role, body.role)) throw forbidden("You cannot invite users with this role");

    const existingUser = await prisma.user.findUnique({ where: { email: body.email }, include: { memberships: true } });
    if (existingUser) {
      throw conflict(
        existingUser.memberships.some((m) => m.organizationId === auth.organizationId)
          ? "This person is already a member"
          : "This email already has a SecureScope account",
      );
    }
    await prisma.invitation.updateMany({
      where: { organizationId: auth.organizationId, email: body.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = randomToken(32);
    const invite = await prisma.invitation.create({
      data: {
        organizationId: auth.organizationId,
        email: body.email,
        role: body.role,
        tokenHash: sha256(token),
        invitedById: auth.user.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const link = `${env.APP_ORIGIN}/invite/${token}`;
    let emailed = false;
    if (mailer.configured) {
      try {
        await mailer.send([body.email], "You have been invited to SecureScope", `${auth.user.name} invited you to join their organization on SecureScope.\n\nAccept the invitation (valid for 7 days):\n${link}`);
        emailed = true;
      } catch (err) {
        req.log.warn({ err }, "invitation e-mail failed");
      }
    }
    await audit(req, { action: "team.invite", resourceType: "invitation", resourceId: invite.id, metadata: { email: body.email, role: body.role, emailed } });
    // The link is returned once so an admin can share it when e-mail is not configured. Only its hash is stored.
    return reply.code(201).send({ id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, emailed, link });
  });

  app.delete("/team/invitations/:id", { preHandler: requireAuth("team:manage") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const result = await prisma.invitation.updateMany({
      where: { id, organizationId: auth.organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw notFound("Invitation");
    await audit(req, { action: "team.invitation_revoke", resourceType: "invitation", resourceId: id });
    return { ok: true };
  });

  app.patch("/team/members/:id", { preHandler: requireAuth("team:manage") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(roleSchema, req.body);
    const member = await prisma.membership.findFirst({ where: { id, organizationId: auth.organizationId }, include: { user: true } });
    if (!member) throw notFound("Member");
    if (member.userId === auth.user.id) throw badRequest("You cannot change your own role");
    if (!outranks(auth.role, member.role) || !canAssignRole(auth.role, body.role)) {
      throw forbidden("You cannot change the role of this member");
    }
    if (member.role === "OWNER" && body.role !== "OWNER") {
      const owners = await prisma.membership.count({ where: { organizationId: auth.organizationId, role: "OWNER" } });
      if (owners <= 1) throw badRequest("An organization must keep at least one owner");
    }
    await prisma.membership.update({ where: { id }, data: { role: body.role } });
    await audit(req, { action: "team.role_change", resourceType: "membership", resourceId: id, metadata: { email: member.user.email, from: member.role, to: body.role } });
    return { ok: true };
  });

  app.delete("/team/members/:id", { preHandler: requireAuth("team:manage") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const member = await prisma.membership.findFirst({ where: { id, organizationId: auth.organizationId }, include: { user: true } });
    if (!member) throw notFound("Member");
    if (member.userId === auth.user.id) throw badRequest("You cannot remove yourself");
    if (!outranks(auth.role, member.role)) throw forbidden("You cannot remove this member");
    if (member.role === "OWNER") {
      const owners = await prisma.membership.count({ where: { organizationId: auth.organizationId, role: "OWNER" } });
      if (owners <= 1) throw badRequest("An organization must keep at least one owner");
    }
    await prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id } });
      await tx.session.deleteMany({ where: { userId: member.userId, organizationId: auth.organizationId } });
      // Users exist only through memberships; remove the account when it has none left.
      const remaining = await tx.membership.count({ where: { userId: member.userId } });
      if (remaining === 0) await tx.user.delete({ where: { id: member.userId } });
    });
    await audit(req, { action: "team.member_remove", resourceType: "membership", resourceId: id, metadata: { email: member.user.email, role: member.role } });
    return { ok: true };
  });
}
