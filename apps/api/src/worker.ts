import pino from "pino";
import { env } from "./config/env.js";
import { prisma } from "./lib/db.js";
import { runBreachCheck } from "./jobs/breach.js";
import { monitorTick } from "./jobs/monitor.js";
import { getBoss, QUEUES } from "./jobs/queue.js";
import { failScan, runScan } from "./scanner/engine.js";

const log = pino({
  name: "worker",
  level: env.NODE_ENV === "production" ? "info" : "debug",
  ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
});

const boss = await getBoss();

await boss.work<{ scanId: string }>(QUEUES.scan, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
  if (!job) return;
  try {
    await runScan(job.data.scanId, log);
  } catch (err) {
    log.error({ err, scanId: job.data.scanId }, "scan crashed");
    await failScan(job.data.scanId, "Internal scanner error");
  }
});

await boss.work<{ monitorId: string }>(QUEUES.breachCheck, { batchSize: 1 }, async ([job]) => {
  if (job) await runBreachCheck(job.data.monitorId, log);
});

await boss.work(QUEUES.monitorTick, async () => {
  await monitorTick(log);
});

// Cron granularity is one minute; tick at the configured cadence.
const minutes = Math.max(1, Math.round(env.MONITOR_TICK_SECONDS / 60));
await boss.schedule(QUEUES.monitorTick, `*/${minutes} * * * *`);

// Scans left RUNNING by a crashed worker are marked failed on startup.
const orphaned = await prisma.scan.updateMany({
  where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
  data: { status: "FAILED", error: "Worker stopped during scan", finishedAt: new Date() },
});
log.info({ orphaned: orphaned.count, tickMinutes: minutes }, "worker started");

const shutdown = async () => {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
