import type { Severity } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/db.js";
import { atLeast } from "../scanner/scoring.js";
import { safePostJson } from "./webhook.js";
import { mailer } from "./mailer.js";

export interface Alert {
  organizationId: string;
  severity: Severity;
  title: string;
  body: string;
  link?: string;
}

/**
 * Fan an alert out to administrators: in-app always, e-mail and webhook when configured.
 * Delivery failures are logged, never thrown, so monitoring keeps running.
 */
export async function dispatchAlerts(alerts: Alert[], log: { warn: (o: object, m: string) => void }) {
  if (alerts.length === 0) return;
  const orgId = alerts[0]!.organizationId;
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: orgId } });
  const threshold = settings?.minAlertSeverity ?? "HIGH";
  const relevant = alerts.filter((a) => atLeast(a.severity, threshold));
  if (relevant.length === 0) return;

  const admins = await prisma.membership.findMany({
    where: { organizationId: orgId, role: { in: ["OWNER", "SECURITY_ADMIN"] } },
    select: { userId: true },
  });
  await prisma.notification.createMany({
    data: relevant.flatMap((a) =>
      admins.map((m) => ({ organizationId: orgId, userId: m.userId, title: a.title, body: a.body, link: a.link })),
    ),
  });

  const digest = relevant.map((a) => `[${a.severity}] ${a.title}\n${a.body}`).join("\n\n");
  const subject = `SecureScope: ${relevant.length} security alert(s)`;

  if (settings?.alertEmails.length && mailer.configured) {
    try {
      await mailer.send(settings.alertEmails, subject, `${digest}\n\n${env.APP_ORIGIN}/monitoring`);
    } catch (err) {
      log.warn({ err }, "alert e-mail delivery failed");
    }
  }
  if (settings?.webhookUrl) {
    try {
      await safePostJson(settings.webhookUrl, {
        text: `${subject}\n\n${digest}`,
        alerts: relevant.map(({ severity, title, body, link }) => ({ severity, title, body, link })),
      });
    } catch (err) {
      log.warn({ err }, "alert webhook delivery failed");
    }
  }
}
