import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { cleanText, pagination, parse, uuidParam } from "../../lib/validation.js";
import { buildReport, type ReportContent } from "./builder.js";
import { renderReportPdf } from "./pdf.js";

const createSchema = z.object({
  title: cleanText(150).pipe(z.string().min(3)),
  assetIds: z.array(z.string().uuid()).max(500).optional(),
});

export async function reportRoutes(app: FastifyInstance) {
  app.get("/reports", { preHandler: requireAuth("reports:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(pagination, req.query);
    const [rows, total] = await Promise.all([
      prisma.report.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.report.count({ where: { organizationId } }),
    ]);
    // Return only the summary for list views.
    const items = rows.map(({ content, ...r }) => {
      const c = content as unknown as ReportContent;
      return { ...r, summary: c.summary, scope: c.scope, generatedBy: c.generatedBy };
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.post(
    "/reports",
    { preHandler: requireAuth("reports:create"), config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const auth = getAuth(req);
      const body = parse(createSchema, req.body);
      if (body.assetIds?.length) {
        const owned = await prisma.asset.count({ where: { id: { in: body.assetIds }, organizationId: auth.organizationId } });
        if (owned !== new Set(body.assetIds).size) throw badRequest("One or more selected assets do not exist");
      }
      const content = await buildReport({ organizationId: auth.organizationId, generatedBy: auth.user.name, assetIds: body.assetIds });
      const report = await prisma.report.create({
        data: {
          organizationId: auth.organizationId,
          title: body.title,
          createdById: auth.user.id,
          content: content as unknown as Prisma.InputJsonValue,
        },
      });
      await audit(req, { action: "report.create", resourceType: "report", resourceId: report.id, metadata: { title: body.title } });
      return reply.code(201).send({ id: report.id });
    },
  );

  app.get("/reports/:id", { preHandler: requireAuth("reports:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const report = await prisma.report.findFirst({ where: { id, organizationId } });
    if (!report) throw notFound("Report");
    return report;
  });

  app.get("/reports/:id/pdf", { preHandler: requireAuth("reports:read") }, async (req, reply) => {
    const { organizationId } = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const report = await prisma.report.findFirst({ where: { id, organizationId } });
    if (!report) throw notFound("Report");
    const pdf = await renderReportPdf(report.title, report.content as unknown as ReportContent);
    await audit(req, { action: "report.export", resourceType: "report", resourceId: id, metadata: { format: "pdf" } });
    const filename = `securescope-report-${report.createdAt.toISOString().slice(0, 10)}.pdf`;
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Cache-Control", "no-store")
      .send(pdf);
  });

  app.delete("/reports/:id", { preHandler: requireAuth("reports:delete") }, async (req) => {
    const { organizationId } = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const result = await prisma.report.deleteMany({ where: { id, organizationId } });
    if (!result.count) throw notFound("Report");
    await audit(req, { action: "report.delete", resourceType: "report", resourceId: id });
    return { ok: true };
  });
}
