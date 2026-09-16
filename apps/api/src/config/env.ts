import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: bool,
  TRUST_PROXY: bool,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SCAN_PORTS: z
    .string()
    .default("21,22,23,25,53,80,110,143,443,445,3306,3389,5432,6379,8080,8443,27017")
    .transform((s, ctx) => {
      const ports = s.split(",").map((p) => Number(p.trim()));
      if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid port list" });
      }
      return [...new Set(ports)].slice(0, 100);
    }),
  SCAN_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  MONITOR_TICK_SECONDS: z.coerce.number().int().min(30).default(300),
  HIBP_API_KEY: optional,
  HIBP_USER_AGENT: z.string().default("SecureScope"),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  SMTP_FROM: z.string().default("SecureScope <alerts@example.com>"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE must be true in production");
  }
  return parsed.data;
}

export const env = load();
