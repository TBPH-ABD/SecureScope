import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/db.js";
import { randomToken, sha256 } from "../lib/crypto.js";

export const SESSION_COOKIE = "ss_session";

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  user: { id: string; email: string; name: string };
  organizationId: string;
  role: Role;
}

export async function createSession(opts: {
  userId: string;
  organizationId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      csrfToken,
      userId: opts.userId,
      organizationId: opts.organizationId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent?.slice(0, 300),
      expiresAt,
    },
  });
  return { token, csrfToken, expiresAt };
}

export async function resolveSession(token: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + env.SESSION_IDLE_MINUTES * 60_000;
  const staleAfterPasswordChange = session.createdAt < session.user.passwordChangedAt;
  if (session.expiresAt.getTime() < now || idleLimit < now || staleAfterPasswordChange) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
  });
  if (!membership) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Throttle last-seen writes to once a minute.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    organizationId: session.organizationId,
    role: membership.role,
  };
}

export const destroySession = (sessionId: string) =>
  prisma.session.deleteMany({ where: { id: sessionId } });

export const destroyUserSessions = (userId: string, exceptSessionId?: string) =>
  prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });

export const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
});
