import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/db.js";
import { getBoss } from "./jobs/queue.js";

const app = await buildApp();
// The API only publishes jobs; the worker process consumes them.
await getBoss();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  const boss = await getBoss();
  await boss.stop({ graceful: true });
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
