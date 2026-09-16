import { breachProvider, maskEmail } from "../integrations/breach.js";
import { dispatchAlerts } from "../integrations/notifier.js";
import { sha256 } from "../lib/crypto.js";
import { prisma } from "../lib/db.js";

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

export async function runBreachCheck(monitorId: string, log: Log) {
  const monitor = await prisma.breachMonitor.findUnique({ where: { id: monitorId } });
  if (!monitor) return;

  // Same authorization rule as scanning: only verified domains of this organization.
  const domainAsset = await prisma.asset.findFirst({
    where: { organizationId: monitor.organizationId, type: "DOMAIN", value: monitor.domain, authorizationStatus: "VERIFIED" },
  });
  if (!domainAsset) {
    await prisma.breachMonitor.update({
      where: { id: monitorId },
      data: { lastCheckedAt: new Date(), lastError: "Domain is no longer a verified asset of this organization" },
    });
    return;
  }

  try {
    const exposures = await breachProvider.searchDomain(monitor.domain);
    let added = 0;
    for (const exp of exposures) {
      for (const breachName of exp.breaches) {
        const details = await breachProvider.breachDetails(breachName);
        const emailHash = sha256(exp.email.toLowerCase());
        const result = await prisma.breachExposure.upsert({
          where: { monitorId_emailHash_breachName: { monitorId, emailHash, breachName } },
          create: {
            monitorId,
            emailHash,
            emailMasked: maskEmail(exp.email),
            breachName: details?.title ?? breachName,
            breachDate: details?.breachDate ? new Date(details.breachDate) : null,
            // Data classes describe *what kind* of data leaked; the values themselves are never fetched.
            dataClasses: details?.dataClasses ?? [],
          },
          update: {},
          select: { firstSeenAt: true },
        });
        if (Date.now() - result.firstSeenAt.getTime() < 60_000) added++;
      }
    }
    await prisma.breachMonitor.update({ where: { id: monitorId }, data: { lastCheckedAt: new Date(), lastError: null } });

    if (added > 0) {
      await prisma.changeEvent.create({
        data: {
          organizationId: monitor.organizationId,
          kind: "breach.new_exposure",
          severity: "HIGH",
          summary: `${added} new breach exposure(s) for @${monitor.domain}`,
          details: { domain: monitor.domain, count: added },
        },
      });
      await dispatchAlerts(
        [{
          organizationId: monitor.organizationId,
          severity: "HIGH",
          title: `New breach exposures for @${monitor.domain}`,
          body: `${added} account/breach combination(s) were found. Reset affected passwords and enforce MFA.`,
          link: "/monitoring?tab=breaches",
        }],
        log,
      );
    }
    log.info({ monitorId, exposures: exposures.length, added }, "breach check finished");
  } catch (err) {
    await prisma.breachMonitor.update({
      where: { id: monitorId },
      data: { lastCheckedAt: new Date(), lastError: String((err as Error).message).slice(0, 300) },
    });
    log.warn({ err, monitorId }, "breach check failed");
  }
}
