import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { breachProvider } from "../../integrations/breach.js";
import { mailer } from "../../integrations/mailer.js";
import { enqueueBreachCheck } from "../../jobs/queue.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/db.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { normalizeHostname } from "../../lib/net.js";
import { pagination, parse, uuidParam } from "../../lib/validation.js";

const severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);

const scheduleSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().refine((h) => [6, 12, 24, 72, 168].includes(h), "Interval must be 6, 12, 24, 72 or 168 hours"),
});

const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => {
    const url = new URL(u);
    return url.protocol === "https:" && !url.username && !url.password && normalizeHostname(url.hostname) !== null;
  }, "Webhook must be an https URL on a public hostname");

const settingsSchema = z.object({
  alertEmails: z.array(z.string().trim().toLowerCase().email().max(254)).max(10),
  webhookUrl: webhookUrl.nullable(),
  minAlertSeverity: severity,
});

export async function monitoringRoutes(app: FastifyInstance) {
  app.get("/monitoring", { preHandler: requireAuth("monitoring:read") }, async (req) => {
    const auth = getAuth(req);
    const [schedule, settings, monitored] = await Promise.all([
      prisma.monitorSchedule.findUnique({ where: { organizationId: auth.organizationId } }),
      prisma.organizationSettings.findUnique({ where: { organizationId: auth.organizationId } }),
      prisma.asset.count({ where: { organizationId: auth.organizationId, monitoringEnabled: true, authorizationStatus: "VERIFIED", type: { not: "OTHER" } } }),
    ]);
    const canManage = auth.role === "OWNER" || auth.role === "SECURITY_ADMIN";
    return {
      schedule,
      monitoredAssets: monitored,
      settings: canManage ? settings : null,
      integrations: { email: mailer.configured, breachProvider: breachProvider.configured ? breachProvider.id : null },
    };
  });

  app.get("/monitoring/events", { preHandler: requireAuth("monitoring:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(pagination.extend({ severity: severity.optional(), assetId: z.string().uuid().optional() }), req.query);
    const where = { organizationId, ...(q.severity ? { severity: q.severity } : {}), ...(q.assetId ? { assetId: q.assetId } : {}) };
    const [items, total] = await Promise.all([
      prisma.changeEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { asset: { select: { id: true, value: true } } },
      }),
      prisma.changeEvent.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.put("/monitoring/schedule", { preHandler: requireAuth("monitoring:manage") }, async (req) => {
    const auth = getAuth(req);
    const body = parse(scheduleSchema, req.body);
    const schedule = await prisma.monitorSchedule.upsert({
      where: { organizationId: auth.organizationId },
      create: { organizationId: auth.organizationId, ...body },
      update: { ...body, nextRunAt: new Date(Date.now() + body.intervalHours * 3600_000) },
    });
    await audit(req, { action: "monitoring.schedule_update", resourceType: "schedule", resourceId: schedule.id, metadata: body });
    return schedule;
  });

  app.put("/monitoring/settings", { preHandler: requireAuth("monitoring:manage") }, async (req) => {
    const auth = getAuth(req);
    const body = parse(settingsSchema, req.body);
    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId: auth.organizationId },
      create: { organizationId: auth.organizationId, ...body },
      update: body,
    });
    await audit(req, {
      action: "monitoring.settings_update",
      resourceType: "settings",
      resourceId: auth.organizationId,
      metadata: { alertEmails: body.alertEmails.length, webhook: Boolean(body.webhookUrl), minAlertSeverity: body.minAlertSeverity },
    });
    return settings;
  });

  // ── Breach monitoring ──
  app.get("/monitoring/breach-monitors", { preHandler: requireAuth("breach:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const monitors = await prisma.breachMonitor.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { exposures: true } } },
    });
    return { configured: breachProvider.configured, provider: breachProvider.id, monitors };
  });

  app.post("/monitoring/breach-monitors", { preHandler: requireAuth("breach:manage") }, async (req, reply) => {
    const auth = getAuth(req);
    const { domain: raw } = parse(z.object({ domain: z.string().max(253) }), req.body);
    const domain = normalizeHostname(raw);
    if (!domain) throw badRequest("Enter a valid domain");
    const asset = await prisma.asset.findFirst({
      where: { organizationId: auth.organizationId, type: "DOMAIN", value: domain, authorizationStatus: "VERIFIED" },
    });
    if (!asset) {
      throw new AppError(403, "ASSET_NOT_AUTHORIZED", "Only verified domains in your asset inventory can be monitored for breaches");
    }
    const existing = await prisma.breachMonitor.findUnique({ where: { organizationId_domain: { organizationId: auth.organizationId, domain } } });
    if (existing) throw conflict("This domain is already monitored");
    const monitor = await prisma.breachMonitor.create({ data: { organizationId: auth.organizationId, domain } });
    if (breachProvider.configured) await enqueueBreachCheck(monitor.id);
    await audit(req, { action: "breach.monitor_create", resourceType: "breach_monitor", resourceId: monitor.id, metadata: { domain } });
    return reply.code(201).send(monitor);
  });

  app.delete("/monitoring/breach-monitors/:id", { preHandler: requireAuth("breach:manage") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const monitor = await prisma.breachMonitor.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!monitor) throw notFound("Breach monitor");
    await prisma.breachMonitor.delete({ where: { id } });
    await audit(req, { action: "breach.monitor_delete", resourceType: "breach_monitor", resourceId: id, metadata: { domain: monitor.domain } });
    return { ok: true };
  });

  app.post(
    "/monitoring/breach-monitors/:id/check",
    { preHandler: requireAuth("breach:manage"), config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const auth = getAuth(req);
      const { id } = parse(uuidParam, req.params);
      const monitor = await prisma.breachMonitor.findFirst({ where: { id, organizationId: auth.organizationId } });
      if (!monitor) throw notFound("Breach monitor");
      if (!breachProvider.configured) {
        throw new AppError(503, "PROVIDER_NOT_CONFIGURED", "Breach monitoring provider is not configured (HIBP_API_KEY)");
      }
      await enqueueBreachCheck(id);
      await audit(req, { action: "breach.check_request", resourceType: "breach_monitor", resourceId: id });
      return reply.code(202).send({ queued: true });
    },
  );

  app.get("/monitoring/breach-monitors/:id/exposures", { preHandler: requireAuth("breach:read") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const q = parse(pagination, req.query);
    const monitor = await prisma.breachMonitor.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!monitor) throw notFound("Breach monitor");
    const [items, total] = await Promise.all([
      prisma.breachExposure.findMany({
        where: { monitorId: id },
        orderBy: [{ breachDate: "desc" }, { firstSeenAt: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        // emailHash is internal; only the masked address is ever returned.
        select: { id: true, emailMasked: true, breachName: true, breachDate: true, dataClasses: true, firstSeenAt: true },
      }),
      prisma.breachExposure.count({ where: { monitorId: id } }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  // ── In-app notifications ──
  app.get("/notifications", { preHandler: requireAuth() }, async (req) => {
    const auth = getAuth(req);
    const where = { userId: auth.user.id, organizationId: auth.organizationId };
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unread };
  });

  app.post("/notifications/read", { preHandler: requireAuth() }, async (req) => {
    const auth = getAuth(req);
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(100).optional() }), req.body ?? {});
    await prisma.notification.updateMany({
      where: { userId: auth.user.id, organizationId: auth.organizationId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
