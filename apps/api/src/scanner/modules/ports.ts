import { Socket } from "node:net";
import type { Severity } from "@prisma/client";
import type { FindingDraft, ScannerModule } from "../types.js";

interface PortRisk {
  service: string;
  severity: Severity;
  why: string;
}

const RISKY: Record<number, PortRisk> = {
  21: { service: "FTP", severity: "MEDIUM", why: "FTP transmits credentials in clear text." },
  23: { service: "Telnet", severity: "HIGH", why: "Telnet is unencrypted and a frequent target of credential attacks." },
  445: { service: "SMB", severity: "HIGH", why: "SMB exposed to the internet has been the entry point of major worms (e.g. WannaCry)." },
  1433: { service: "Microsoft SQL Server", severity: "HIGH", why: "Databases should not be reachable from the internet." },
  1521: { service: "Oracle DB", severity: "HIGH", why: "Databases should not be reachable from the internet." },
  2375: { service: "Docker API (unencrypted)", severity: "CRITICAL", why: "An exposed Docker daemon allows full host takeover without authentication." },
  3306: { service: "MySQL", severity: "HIGH", why: "Databases should not be reachable from the internet." },
  3389: { service: "RDP", severity: "HIGH", why: "Internet-facing RDP is heavily targeted by brute-force and ransomware operators." },
  5432: { service: "PostgreSQL", severity: "HIGH", why: "Databases should not be reachable from the internet." },
  5900: { service: "VNC", severity: "HIGH", why: "VNC often has weak authentication and is heavily scanned." },
  6379: { service: "Redis", severity: "HIGH", why: "Redis frequently runs without authentication and can lead to remote code execution." },
  9200: { service: "Elasticsearch", severity: "HIGH", why: "Exposed Elasticsearch clusters are a common source of data leaks." },
  11211: { service: "Memcached", severity: "HIGH", why: "Memcached can leak cached data and be abused for DDoS amplification." },
  27017: { service: "MongoDB", severity: "HIGH", why: "Exposed MongoDB instances are a common source of data leaks." },
  110: { service: "POP3", severity: "LOW", why: "Plain POP3 may transmit credentials unencrypted." },
  143: { service: "IMAP", severity: "LOW", why: "Plain IMAP may transmit credentials unencrypted." },
};

const KNOWN: Record<number, string> = {
  22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP", 443: "HTTPS", 465: "SMTPS", 587: "SMTP Submission",
  993: "IMAPS", 995: "POP3S", 8080: "HTTP (alt)", 8443: "HTTPS (alt)",
};

export function probePort(host: string, port: number, timeoutMs: number): Promise<"open" | "closed" | "filtered"> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (state: "open" | "closed" | "filtered") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("filtered"));
    socket.once("error", (err: NodeJS.ErrnoException) => finish(err.code === "ECONNREFUSED" ? "closed" : "filtered"));
    socket.connect(port, host);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export const portsModule: ScannerModule = {
  id: "ports",
  name: "Exposed Services",
  description: "TCP connect check against a limited, configurable list of well-known service ports.",
  appliesTo: ["DOMAIN", "SUBDOMAIN", "IP_ADDRESS"],
  async run({ target, addresses, ports, timeoutMs }) {
    const address = addresses.find((a) => !a.includes(":")) ?? addresses[0]!;
    const perPortTimeout = Math.min(timeoutMs, 3000);
    const states = await mapLimit(ports, 10, (p) => probePort(address, p, perPortTimeout));
    const open = ports.filter((_, i) => states[i] === "open").sort((a, b) => a - b);

    const findings: FindingDraft[] = open
      .filter((p) => RISKY[p])
      .map((p) => {
        const risk = RISKY[p]!;
        return {
          checkId: "ports.risky_service",
          detail: String(p),
          title: `${risk.service} exposed to the internet (port ${p})`,
          severity: risk.severity,
          description: `${risk.why} Port ${p}/tcp accepted a connection on ${address}.`,
          remediation: "Restrict access with a firewall or security group to trusted IP ranges or a VPN, or disable the service if unused.",
          evidence: { host: target.host, address, port: p, protocol: "tcp", state: "open" },
        };
      });

    return {
      observations: {
        address,
        scannedPorts: ports,
        open: open.map((p) => ({ port: p, service: RISKY[p]?.service ?? KNOWN[p] ?? "unknown" })),
        filteredCount: states.filter((s) => s === "filtered").length,
      },
      findings,
    };
  },
};
