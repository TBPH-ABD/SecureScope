import { promises as dns } from "node:dns";
import type { FindingDraft, ScannerModule } from "../types.js";

async function txtRecords(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(""));
  } catch {
    return [];
  }
}

export function evaluateSpf(records: string[]): FindingDraft[] {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (spf.length === 0) {
    return [{
      checkId: "email.spf_missing",
      title: "SPF record missing",
      severity: "MEDIUM",
      description: "The domain publishes no SPF policy, so receiving mail servers cannot tell which hosts may send mail for it. This makes spoofing easier.",
      remediation: 'Publish a TXT record such as `v=spf1 include:<your-provider> -all`. If the domain sends no mail, use `v=spf1 -all`.',
      evidence: { spf: null },
      references: ["https://www.rfc-editor.org/rfc/rfc7208"],
    }];
  }
  if (spf.length > 1) {
    return [{
      checkId: "email.spf_multiple",
      title: "Multiple SPF records",
      severity: "MEDIUM",
      description: "More than one SPF record is a permanent error (permerror); receivers will treat SPF as broken.",
      remediation: "Merge all mechanisms into a single `v=spf1` TXT record.",
      evidence: { spf },
    }];
  }
  const record = spf[0]!;
  const all = record.match(/\s([+?~-]?)all\b/i);
  const qualifier = all ? all[1] || "+" : null;
  if (qualifier === "+") {
    return [{
      checkId: "email.spf_permissive",
      title: "SPF allows any sender (+all)",
      severity: "HIGH",
      description: "The SPF policy authorises every host on the internet to send mail for this domain.",
      remediation: "Replace `+all` with `-all` (or `~all` during rollout).",
      evidence: { spf: record },
    }];
  }
  if (qualifier === null || qualifier === "?") {
    return [{
      checkId: "email.spf_neutral",
      title: "SPF policy is not enforcing",
      severity: "LOW",
      description: "The SPF record ends without a fail (`-all`) or softfail (`~all`) mechanism, so unauthorised senders are not flagged.",
      remediation: "End the record with `-all` once all legitimate senders are listed.",
      evidence: { spf: record },
    }];
  }
  return [];
}

export function evaluateDmarc(records: string[]): FindingDraft[] {
  const dmarc = records.filter((r) => /^v=DMARC1/i.test(r));
  if (dmarc.length === 0) {
    return [{
      checkId: "email.dmarc_missing",
      title: "DMARC record missing",
      severity: "MEDIUM",
      description: "Without DMARC, receivers have no instruction for handling mail that fails SPF/DKIM, and you receive no reports about spoofing attempts.",
      remediation: "Publish `_dmarc.<domain>` TXT `v=DMARC1; p=none; rua=mailto:dmarc@<domain>`, monitor reports, then move to `p=quarantine` or `p=reject`.",
      evidence: { dmarc: null },
      references: ["https://www.rfc-editor.org/rfc/rfc7489"],
    }];
  }
  const record = dmarc[0]!;
  const policy = record.match(/;\s*p\s*=\s*(\w+)/i)?.[1]?.toLowerCase();
  if (!policy || policy === "none") {
    return [{
      checkId: "email.dmarc_monitor_only",
      title: "DMARC policy is monitor-only (p=none)",
      severity: "LOW",
      description: "The DMARC policy does not ask receivers to quarantine or reject spoofed mail.",
      remediation: "After reviewing aggregate reports, raise the policy to `p=quarantine` and then `p=reject`.",
      evidence: { dmarc: record },
    }];
  }
  return [];
}

export const emailSecurityModule: ScannerModule = {
  id: "email-security",
  name: "Domain Configuration",
  description: "Checks SPF, DMARC and MTA-STS configuration that protects the domain against e-mail spoofing.",
  appliesTo: ["DOMAIN"],
  async run({ target }) {
    const [root, dmarc, mtaSts] = await Promise.all([
      txtRecords(target.host),
      txtRecords(`_dmarc.${target.host}`),
      txtRecords(`_mta-sts.${target.host}`),
    ]);
    let mx: string[] = [];
    try {
      mx = (await dns.resolveMx(target.host)).map((m) => m.exchange);
    } catch {
      mx = [];
    }
    const findings = [...evaluateSpf(root), ...evaluateDmarc(dmarc)];
    const hasMtaSts = mtaSts.some((r) => /^v=STSv1/i.test(r));
    if (mx.length > 0 && !hasMtaSts) {
      findings.push({
        checkId: "email.mta_sts_missing",
        title: "MTA-STS not configured",
        severity: "INFO",
        description: "The domain receives mail but does not publish an MTA-STS policy, so inbound TLS can be downgraded by an active attacker.",
        remediation: "Publish an MTA-STS policy (`_mta-sts` TXT record and https://mta-sts.<domain>/.well-known/mta-sts.txt).",
        evidence: { mx },
        references: ["https://www.rfc-editor.org/rfc/rfc8461"],
      });
    }
    return {
      observations: {
        spf: root.filter((r) => /^v=spf1/i.test(r)),
        dmarc: dmarc.filter((r) => /^v=DMARC1/i.test(r)),
        mtaSts: hasMtaSts,
        mx,
      },
      findings,
    };
  },
};
