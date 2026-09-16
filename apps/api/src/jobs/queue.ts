import PgBoss from "pg-boss";
import { env } from "../config/env.js";

export const QUEUES = {
  scan: "scan-run",
  monitorTick: "monitor-tick",
  breachCheck: "breach-check",
} as const;

let instance: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  instance ??= (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    for (const name of Object.values(QUEUES)) {
      await boss.createQueue(name).catch(() => undefined);
    }
    return boss;
  })();
  return instance;
}

export async function enqueueScan(scanId: string) {
  const boss = await getBoss();
  // singletonKey prevents the same scan from being queued twice.
  await boss.send(QUEUES.scan, { scanId }, { singletonKey: scanId, retryLimit: 0, expireInSeconds: 60 * 30 });
}

export async function enqueueBreachCheck(monitorId: string) {
  const boss = await getBoss();
  await boss.send(QUEUES.breachCheck, { monitorId }, { singletonKey: monitorId, retryLimit: 1 });
}
