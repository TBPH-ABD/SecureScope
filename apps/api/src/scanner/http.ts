import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isNonPublicIp } from "../lib/net.js";

export interface HttpHop {
  url: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

export interface HttpResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  hops: HttpHop[];
}

const MAX_BODY = 512 * 1024;
const MAX_REDIRECTS = 5;

/**
 * DNS lookup that refuses non-public answers at connect time, closing the
 * window between "validated the hostname" and "opened the socket".
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isNonPublicIp(a.address));
    if (bad) return callback(new Error(`Blocked non-public address ${bad.address}`), "", 0);
    if ((options as { all?: boolean }).all) return (callback as any)(null, list);
    const first = list[0];
    if (!first) return callback(new Error("No address"), "", 0);
    callback(null, first.address, first.family);
  });
};

function requestOnce(url: URL, timeoutMs: number): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isNonPublicIp(url.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new Error("Blocked non-public address"));
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        // Certificate problems are reported by the TLS module; here we still want headers.
        rejectUnauthorized: false,
        headers: {
          "User-Agent": "SecureScope-Scanner/1.0 (+authorized security assessment)",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BODY) chunks.push(c);
          else res.destroy();
        });
        const done = () =>
          resolve({
            finalUrl: url.toString(),
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            hops: [],
          });
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

/** GET with manual redirect handling; every hop goes through the SSRF-safe lookup. */
export async function safeGet(startUrl: string, timeoutMs: number): Promise<HttpResult> {
  let url = new URL(startUrl);
  const hops: HttpHop[] = [];
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await requestOnce(url, timeoutMs);
    hops.push({ url: url.toString(), status: res.status, headers: res.headers });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && typeof location === "string") {
      const next = new URL(location, url);
      if (next.protocol !== "http:" && next.protocol !== "https:") break;
      url = next;
      continue;
    }
    return { ...res, hops };
  }
  throw new Error("Too many redirects");
}

export const headerValue = (h: HttpResult["headers"], name: string): string | undefined => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v.join(", ") : v;
};
