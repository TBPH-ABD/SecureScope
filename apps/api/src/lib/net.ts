import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { getDomain, parse as parseHost } from "tldts";

/**
 * Network-safety helpers. Every scanner resolves targets through
 * `resolvePublicAddresses`, so a hostname that points at internal
 * infrastructure (DNS rebinding, split-horizon, metadata endpoints) is refused.
 */

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function normalizeHostname(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_RE.test(host)) return null;
  // Must end in an ICANN-listed public suffix (rejects "foo.local", "intranet.corp", "x.internal").
  const parsed = parseHost(host, { allowPrivateDomains: false });
  if (!parsed.isIcann || !parsed.publicSuffix || parsed.publicSuffix === host || !parsed.domain) return null;
  return host;
}

/** Registrable domain ("app.eu.example.co.uk" → "example.co.uk"). */
export function registrableDomain(host: string): string | null {
  return getDomain(host, { allowPrivateDomains: false }) ?? null;
}

export function normalizeIp(input: string): string | null {
  const ip = input.trim().toLowerCase();
  return isIP(ip) ? ip : null;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Cidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** True for any address that is not a globally routable unicast address. */
export function isNonPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return BLOCKED_V4.some(([base, bits]) => inV4Cidr(ip, base, bits));
  if (version === 6) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNonPublicIp(mapped[1]!);
    if (v6 === "::" || v6 === "::1") return true;
    const first = parseInt(v6.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (v6.startsWith("2001:db8") || v6.startsWith("2001:0db8")) return true; // documentation
    if (v6.startsWith("64:ff9b:") || v6.startsWith("100::")) return true;
    return false;
  }
  return true;
}

export class UnsafeTargetError extends Error {}

/** Resolve a host (or pass through an IP) and refuse non-public destinations. */
export async function resolvePublicAddresses(target: string): Promise<string[]> {
  if (isIP(target)) {
    if (isNonPublicIp(target)) throw new UnsafeTargetError(`${target} is not a public address`);
    return [target];
  }
  const [v4, v6] = await Promise.all([
    dns.resolve4(target).catch(() => [] as string[]),
    dns.resolve6(target).catch(() => [] as string[]),
  ]);
  const all = [...v4, ...v6];
  if (all.length === 0) throw new UnsafeTargetError(`${target} does not resolve`);
  const blocked = all.filter(isNonPublicIp);
  if (blocked.length > 0) {
    throw new UnsafeTargetError(`${target} resolves to non-public address(es): ${blocked.join(", ")}`);
  }
  return all;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
