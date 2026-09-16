import https from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { resolvePublicAddresses } from "../lib/net.js";

/**
 * POST JSON to an HTTPS webhook. The destination is resolved once, checked
 * against the non-public blocklist, and the connection is pinned to that
 * address while still validating the certificate for the original hostname.
 */
export async function safePostJson(rawUrl: string, payload: unknown, timeoutMs = 5000): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Webhook URL must use https");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const [address] = await resolvePublicAddresses(hostname);
  const body = JSON.stringify(payload);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        host: address,
        servername: isIP(hostname) ? undefined : hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        timeout: timeoutMs,
        headers: { Host: url.host, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          if (status < 400) resolve();
          else reject(new Error(`Webhook returned HTTP ${status}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
