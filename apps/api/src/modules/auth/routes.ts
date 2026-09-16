import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword, burnPasswordCheck } from "../../auth/password.js";
import { permissionsFor } from "../../auth/permissions.js";
import { getAuth, requireAuth } from "../../auth/guards.js";
import {
  cookieOptions,
  createSession,
  destroySession,
  destroyUserSessions,
  SESSION_COOKIE,
} from "../../auth/session.js";
import { audit } from "../../lib/audit.js";
import { sha256 } from "../../lib/crypto.js";
import { prisma } from "../../lib/db.js";
import { AppError, badRequest, conflict, unauthorized } from "../../lib/errors.js";
import { cleanText, parse } from "../../lib/validation.js";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: "Password must include upper-case, lower-case and a digit",
  });

const email = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  name: cleanText(100).pipe(z.string().min(2)),
  email,
  password: passwordSchema,
  organizationName: cleanText(120).pipe(z.string().min(2)),
});

const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

const acceptInviteSchema = z.object({
  token: z.string().min(20).max(100),
  name: cleanText(100).pipe(z.string().min(2)),
  password: passwordSchema,
});

const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } };

async function startSession(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  organizationId: string,
) {
  const session = await createSession({
    userId,
    organizationId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions(), expires: session.expiresAt });
  return session;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", authRateLimit, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      // Generic message to limit account enumeration.
      throw conflict("Unable to register with these details");
    }
    const passwordHash = await hashPassword(body.password);
    const { user, org } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: body.organizationName,
          settings: { create: {} },
          schedules: { create: { intervalHours: 24 } },
        },
      });
      const user = await tx.user.create({
        data: { email: body.email, name: body.name, passwordHash },
      });
      await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
      return { user, org };
    });
    await startSession(req, reply, user.id, org.id);
    await audit(req, {
      action: "auth.register",
      organizationId: org.id,
      actorId: user.id,
      actorEmail: user.email,
      resourceType: "organization",
      resourceId: org.id,
    });
    return reply.code(201).send({ ok: true });
  });

  app.post("/auth/login", authRateLimit, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    });

    if (!user) {
      await burnPasswordCheck(body.password);
      await audit(req, { action: "auth.login", outcome: "failure", organizationId: null, actorId: null, actorEmail: body.email, metadata: { reason: "unknown_user" } });
      throw unauthorized("Invalid email or password");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(req, { action: "auth.login", outcome: "denied", organizationId: user.memberships[0]?.organizationId ?? null, actorId: user.id, actorEmail: user.email, metadata: { reason: "locked" } });
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
    }

    const valid = await verifyPassword(user.passwordHash, body.password);
    const membership = user.memberships[0];
    if (!valid || !membership) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      });
      await audit(req, {
        action: failed >= MAX_FAILED_LOGINS ? "auth.lockout" : "auth.login",
        outcome: "failure",
        organizationId: membership?.organizationId ?? null,
        actorId: user.id,
        actorEmail: user.email,
        metadata: { reason: valid ? "no_membership" : "bad_password", attempt: failed },
      });
      throw unauthorized("Invalid email or password");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await startSession(req, reply, user.id, membership.organizationId);
    await audit(req, { action: "auth.login", organizationId: membership.organizationId, actorId: user.id, actorEmail: user.email });
    return { ok: true };
  });

  app.post("/auth/logout", { preHandler: requireAuth() }, async (req, reply) => {
    const auth = getAuth(req);
    await destroySession(auth.sessionId);
    await audit(req, { action: "auth.logout" });
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { id: true, name: true },
    });
    return {
      user: auth.user,
      organization: org,
      role: auth.role,
      permissions: permissionsFor(auth.role),
      csrfToken: auth.csrfToken,
    };
  });

  app.post("/auth/change-password", { preHandler: requireAuth(), ...authRateLimit }, async (req) => {
    const auth = getAuth(req);
    const body = parse(changePasswordSchema, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      await audit(req, { action: "auth.password_change", outcome: "failure" });
      throw badRequest("Current password is incorrect");
    }
    // passwordChangedAt invalidates every session created before it; keep this one alive.
    const changedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), passwordChangedAt: changedAt },
      }),
      prisma.session.update({ where: { id: auth.sessionId }, data: { createdAt: changedAt } }),
    ]);
    await destroyUserSessions(user.id, auth.sessionId);
    await audit(req, { action: "auth.password_change" });
    return { ok: true };
  });

  app.get("/auth/invitations/:token", authRateLimit, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
    const invite = await prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) {
      throw badRequest("This invitation is invalid or has expired");
    }
    return { email: invite.email, role: invite.role, organization: invite.organization.name };
  });

  app.post("/auth/invitations/accept", authRateLimit, async (req, reply) => {
    const body = parse(acceptInviteSchema, req.body);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash: sha256(body.token) } });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) {
      throw badRequest("This invitation is invalid or has expired");
    }
    if (await prisma.user.findUnique({ where: { email: invite.email } })) {
      throw conflict("An account with this email already exists. Ask an administrator for help.");
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.$transaction(async (tx) => {
      // Conditional update guards against the same token being redeemed twice concurrently.
      const claimed = await tx.invitation.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw badRequest("This invitation is invalid or has expired");
      const user = await tx.user.create({ data: { email: invite.email, name: body.name, passwordHash } });
      await tx.membership.create({
        data: { userId: user.id, organizationId: invite.organizationId, role: invite.role },
      });
      return user;
    });
    await startSession(req, reply, user.id, invite.organizationId);
    await audit(req, {
      action: "team.invitation_accepted",
      organizationId: invite.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      resourceType: "invitation",
      resourceId: invite.id,
      metadata: { role: invite.role },
    });
    return reply.code(201).send({ ok: true });
  });
}
