import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { audit } from "../lib/audit.js";
import { safeEqual } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { can, type Permission } from "./permissions.js";
import { type AuthContext, resolveSession, SESSION_COOKIE } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("auth", undefined);
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.auth = (await resolveSession(token)) ?? undefined;
  });
});

export function getAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Require an authenticated session, a valid CSRF token on writes, and optionally a permission. */
export function requireAuth(permission?: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = getAuth(req);
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, auth.csrfToken)) {
        throw forbidden("Invalid or missing CSRF token");
      }
    }
    if (permission && !can(auth.role, permission)) {
      await audit(req, {
        action: "authz.denied",
        outcome: "denied",
        metadata: { permission, route: req.routeOptions.url ?? req.url, method: req.method },
      });
      throw forbidden();
    }
  };
}
