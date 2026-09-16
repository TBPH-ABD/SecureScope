import { breachProvider } from "../integrations/breach.js";
import { prisma } from "../lib/db.js";
import { enqueueBreachCheck, enqueueScan } from "./queue.js";

type Log = { info: (o: object, m: string) => void };

/** Periodic tick: enqueue scheduled scans for verified, monitored assets whose schedule is due. */
export async function monitorTick(log: Log) {
  const due = await prisma.monitorSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
    take: 50,
  });
  for (const schedule of due) {
    // Claim the schedule first so concurrent ticks do not double-enqueue.
    const next = new Date(Date.now() + schedule.intervalHours * 3600_000);
    const claimed = await prisma.monitorSchedule.updateMany({
      where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
      data: { lastRunAt: new Date(), nextRunAt: next },
    });
    if (claimed.count !== 1) continue;

    const assets = await prisma.asset.findMany({
      where: {
        organizationId: schedule.organizationId,
        monitoringEnabled: true,
        authorizationStatus: "VERIFIED",
        type: { not: "OTHER" },
      },
      select: { id: true },
    });
    for (const asset of assets) {
      const busy = await prisma.scan.count({ where: { assetId: asset.id, status: { in: ["QUEUED", "RUNNING"] } } });
      if (busy) continue;
      const scan = await prisma.scan.create({
        data: { organizationId: schedule.organizationId, assetId: asset.id, trigger: "SCHEDULED", modules: [] },
      });
      await enqueueScan(scan.id);
    }

    if (breachProvider.configured) {
      const monitors = await prisma.breachMonitor.findMany({
        where: { organizationId: schedule.organizationId },
        select: { id: true },
      });
      for (const m of monitors) await enqueueBreachCheck(m.id);
    }
    log.info({ organizationId: schedule.organizationId, assets: assets.length }, "scheduled monitoring enqueued");
  }
}
