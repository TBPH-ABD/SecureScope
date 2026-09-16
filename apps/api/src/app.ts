import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authPlugin } from "./auth/guards.js";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { assetRoutes } from "./modules/assets/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { findingRoutes } from "./modules/findings/routes.js";
import { monitoringRoutes } from "./modules/monitoring/routes.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { scanRoutes } from "./modules/scans/routes.js";
import { teamRoutes } from "./modules/team/routes.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: ["req.headers.cookie", "req.headers['x-csrf-token']", "res.headers['set-cookie']"],
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(authPlugin);

  // Defence in depth next to the CSRF token: reject cross-origin writes outright.
  app.addHook("onRequest", async (req) => {
    if (!UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== env.APP_ORIGIN) {
      throw new AppError(403, "FORBIDDEN", "Cross-origin request rejected");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "An unexpected error occurred" } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }),
  );

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(dashboardRoutes);
      await api.register(assetRoutes);
      await api.register(scanRoutes);
      await api.register(findingRoutes);
      await api.register(reportRoutes);
      await api.register(monitoringRoutes);
      await api.register(teamRoutes);
      await api.register(auditRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
