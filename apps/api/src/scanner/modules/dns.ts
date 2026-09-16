import { promises as dns } from "node:dns";
import type { FindingDraft, ScannerModule } from "../types.js";

type Records = Record<string, unknown>;

async function tryResolve<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return null;
    throw err;
  }
}

export const dnsModule: ScannerModule = {
  id: "dns",
  name: "DNS Records",
  description: "Collects A, AAAA, CNAME, MX, NS, TXT, CAA and SOA records and checks for risky configurations.",
  appliesTo: ["DOMAIN", "SUBDOMAIN", "APPLICATION"],
  async run({ target }) {
    const host = target.host;
    const [a, aaaa, cname, mx, ns, txt, caa, soa] = await Promise.all([
      tryResolve(() => dns.resolve4(host, { ttl: true })),
      tryResolve(() => dns.resolve6(host)),
      tryResolve(() => dns.resolveCname(host)),
      tryResolve(() => dns.resolveMx(host)),
      tryResolve(() => dns.resolveNs(host)),
      tryResolve(() => dns.resolveTxt(host)),
      tryResolve(() => dns.resolveCaa(host)),
      tryResolve(() => dns.resolveSoa(host)),
    ]);

    const records: Records = {
      A: a?.map((r) => r.address).sort() ?? [],
      AAAA: aaaa?.sort() ?? [],
      CNAME: cname ?? [],
      MX: mx?.map((m) => `${m.priority} ${m.exchange}`).sort() ?? [],
      NS: ns?.map((n) => n.toLowerCase()).sort() ?? [],
      TXT: txt?.map((t) => t.join("")).sort() ?? [],
      CAA: caa?.map((c) => JSON.stringify(c)).sort() ?? [],
      SOA: soa ? { nsname: soa.nsname, hostmaster: soa.hostmaster, serial: soa.serial } : null,
    };

    const findings: FindingDraft[] = [];

    // Dangling CNAME → possible subdomain takeover.
    for (const targetName of cname ?? []) {
      const resolves = await Promise.all([
        tryResolve(() => dns.resolve4(targetName)),
        tryResolve(() => dns.resolve6(targetName)),
        tryResolve(() => dns.resolveCname(targetName)),
      ]);
      if (resolves.every((r) => r === null || (Array.isArray(r) && r.length === 0))) {
        findings.push({
          checkId: "dns.dangling_cname",
          detail: targetName,
          title: "Dangling CNAME record (possible subdomain takeover)",
          severity: "HIGH",
          description: `${host} is an alias for ${targetName}, which does not resolve. If the target service was deprovisioned, an attacker may be able to claim it and serve content on your hostname.`,
          remediation: "Remove the CNAME record, or re-provision the target resource so it is under your control.",
          evidence: { host, cname: targetName },
          references: ["https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/10-Test_for_Subdomain_Takeover"],
        });
      }
    }

    if (target.type === "DOMAIN") {
      if (!caa || caa.length === 0) {
        findings.push({
          checkId: "dns.caa_missing",
          title: "No CAA record",
          severity: "LOW",
          description: "Without a CAA record any public certificate authority may issue certificates for this domain.",
          remediation: 'Publish a CAA record listing only the CAs you use, e.g. `example.com. CAA 0 issue "letsencrypt.org"`.',
          evidence: { host, CAA: [] },
          references: ["https://www.rfc-editor.org/rfc/rfc8659"],
        });
      }
      if (ns && ns.length < 2) {
        findings.push({
          checkId: "dns.single_nameserver",
          title: "Only one authoritative name server",
          severity: "MEDIUM",
          description: "A single name server is a single point of failure for every service on the domain.",
          remediation: "Configure at least two name servers on separate networks.",
          evidence: { NS: records.NS },
        });
      }
    }

    if (!a?.length && !aaaa?.length && !cname?.length && target.type !== "DOMAIN") {
      findings.push({
        checkId: "dns.no_address",
        title: "Host does not resolve",
        severity: "INFO",
        description: `${host} has no A, AAAA or CNAME records. It may be decommissioned.`,
        remediation: "Remove the asset from inventory if it is no longer in use.",
        evidence: { host },
      });
    }

    return { observations: records, findings };
  },
};
