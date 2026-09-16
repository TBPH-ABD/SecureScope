import type { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "./db.js";

export interface AuditEntry {
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
  outcome?: "success" | "failure" | "denied";
  organizationId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
}

/** Record an audit entry. Never throws — auditing must not break the request. */
export async function audit(req: FastifyRequest | null, entry: AuditEntry): Promise<void> {
  const auth = req?.auth;
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId !== undefined ? entry.organizationId : auth?.organizationId,
        actorId: entry.actorId !== undefined ? entry.actorId : auth?.user.id,
        actorEmail: entry.actorEmail !== undefined ? entry.actorEmail : auth?.user.email,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
        outcome: entry.outcome ?? "success",
        ipAddress: req?.ip,
        userAgent: req?.headers["user-agent"]?.slice(0, 300),
      },
    });
  } catch (err) {
    req?.log.error({ err, action: entry.action }, "failed to write audit log");
  }
}
