import { checkServerIdentity, connect, type ConnectionOptions, type PeerCertificate, type TLSSocket } from "node:tls";
import type { FindingDraft, ScannerModule } from "../types.js";

const DAY = 86_400_000;

function handshake(opts: ConnectionOptions, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ ...opts, rejectUnauthorized: false });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("TLS handshake timed out")));
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function supportsLegacyTls(address: string, servername: string | undefined, timeoutMs: number) {
  const results: Record<string, boolean> = {};
  for (const version of ["TLSv1", "TLSv1.1"] as const) {
    try {
      const s = await handshake(
        { host: address, port: 443, servername, minVersion: version, maxVersion: version, ciphers: "DEFAULT@SECLEVEL=0" },
        timeoutMs,
      );
      results[version] = s.getProtocol() === version;
      s.destroy();
    } catch {
      results[version] = false;
    }
  }
  return results;
}

export interface CertFacts {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  subjectAltNames: string[];
  selfSigned: boolean;
  keyBits?: number;
  keyType?: string;
  fingerprint256: string;
  serialNumber: string;
}

export function certificateFacts(cert: PeerCertificate, now = Date.now()): CertFacts {
  const validTo = new Date(cert.valid_to);
  const name = (x: Record<string, unknown> | undefined) =>
    x ? Object.entries(x).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`).join(", ") : "";
  return {
    subject: name(cert.subject as unknown as Record<string, unknown>),
    issuer: name(cert.issuer as unknown as Record<string, unknown>),
    validFrom: new Date(cert.valid_from).toISOString(),
    validTo: validTo.toISOString(),
    daysRemaining: Math.floor((validTo.getTime() - now) / DAY),
    subjectAltNames: (cert.subjectaltname ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    selfSigned: name(cert.subject as unknown as Record<string, unknown>) === name(cert.issuer as unknown as Record<string, unknown>),
    keyBits: cert.bits,
    keyType: cert.asn1Curve ? `EC ${cert.asn1Curve}` : cert.modulus ? "RSA" : undefined,
    fingerprint256: cert.fingerprint256,
    serialNumber: cert.serialNumber,
  };
}

export function evaluateCertificate(facts: CertFacts, host: string, authorizationError: string | null): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const evidence = { host, subject: facts.subject, issuer: facts.issuer, validTo: facts.validTo, daysRemaining: facts.daysRemaining };

  if (facts.daysRemaining < 0) {
    findings.push({
      checkId: "tls.cert_expired",
      title: "TLS certificate has expired",
      severity: "CRITICAL",
      description: `The certificate expired ${-facts.daysRemaining} day(s) ago. Browsers block the site and clients may be trained to ignore warnings.`,
      remediation: "Renew the certificate immediately and automate renewal (e.g. ACME).",
      evidence,
    });
  } else if (facts.daysRemaining <= 14) {
    findings.push({
      checkId: "tls.cert_expiring",
      title: "TLS certificate expires within 14 days",
      severity: "HIGH",
      description: `The certificate expires in ${facts.daysRemaining} day(s).`,
      remediation: "Renew the certificate now and confirm automated renewal is working.",
      evidence,
    });
  } else if (facts.daysRemaining <= 30) {
    findings.push({
      checkId: "tls.cert_expiring",
      title: "TLS certificate expires within 30 days",
      severity: "MEDIUM",
      description: `The certificate expires in ${facts.daysRemaining} day(s).`,
      remediation: "Schedule renewal and confirm automated renewal is working.",
      evidence,
    });
  }

  if (authorizationError && facts.daysRemaining >= 0) {
    const mismatch = authorizationError === "ERR_TLS_CERT_ALTNAME_INVALID";
    findings.push({
      checkId: mismatch ? "tls.hostname_mismatch" : "tls.untrusted",
      title: mismatch
        ? "TLS certificate does not match hostname"
        : facts.selfSigned ? "Self-signed TLS certificate" : "TLS certificate is not trusted",
      severity: "HIGH",
      description: mismatch
        ? `The certificate is not valid for ${host}. Visitors see a security warning.`
        : `The certificate chain could not be validated against public trust stores (${authorizationError}).`,
      remediation: "Install a certificate from a publicly trusted CA that covers this hostname, including the full intermediate chain.",
      evidence: { ...evidence, error: authorizationError, subjectAltNames: facts.subjectAltNames },
    });
  }

  if (facts.keyType === "RSA" && facts.keyBits && facts.keyBits < 2048) {
    findings.push({
      checkId: "tls.weak_key",
      title: "Weak RSA key size",
      severity: "MEDIUM",
      description: `The certificate uses a ${facts.keyBits}-bit RSA key. Keys below 2048 bits are considered breakable.`,
      remediation: "Re-issue the certificate with a 2048-bit (or larger) RSA key or an ECDSA P-256 key.",
      evidence: { ...evidence, keyBits: facts.keyBits },
    });
  }
  return findings;
}

export const tlsModule: ScannerModule = {
  id: "tls",
  name: "SSL/TLS Certificate",
  description: "Inspects the certificate and protocol support on port 443.",
  appliesTo: ["DOMAIN", "SUBDOMAIN", "IP_ADDRESS", "APPLICATION"],
  async run({ target, addresses, timeoutMs }) {
    const address = addresses.find((a) => !a.includes(":")) ?? addresses[0]!;
    const servername = target.isIp ? undefined : target.host;

    let socket: TLSSocket;
    try {
      socket = await handshake({ host: address, port: 443, servername }, timeoutMs);
    } catch (err) {
      const message = (err as Error).message;
      return {
        observations: { reachable: false, error: message },
        findings: target.type === "APPLICATION"
          ? [{
              checkId: "tls.no_https",
              title: "Application is not reachable over HTTPS",
              severity: "HIGH",
              description: "No TLS service answered on port 443. Traffic to this application may be sent unencrypted.",
              remediation: "Serve the application over HTTPS with a trusted certificate and redirect HTTP to HTTPS.",
              evidence: { host: target.host, error: message },
            }]
          : [],
      };
    }

    const cert = socket.getPeerCertificate(false);
    const protocol = socket.getProtocol();
    const cipher = socket.getCipher();
    let authorizationError = socket.authorized ? null : String(socket.authorizationError ?? "UNKNOWN");
    socket.destroy();

    if (!cert || Object.keys(cert).length === 0) {
      return { observations: { reachable: true, protocol, error: "No certificate presented" }, findings: [] };
    }
    // Node reports chain errors via authorizationError; hostname match is a separate check.
    if (!authorizationError && servername && checkServerIdentity(servername, cert)) {
      authorizationError = "ERR_TLS_CERT_ALTNAME_INVALID";
    }

    const facts = certificateFacts(cert);
    const findings = evaluateCertificate(facts, target.host, authorizationError);

    const legacy = await supportsLegacyTls(address, servername, timeoutMs);
    const legacyEnabled = Object.entries(legacy).filter(([, on]) => on).map(([v]) => v);
    if (legacyEnabled.length > 0) {
      findings.push({
        checkId: "tls.legacy_protocols",
        title: "Deprecated TLS versions enabled",
        severity: "MEDIUM",
        description: `The server accepts ${legacyEnabled.join(" and ")}, which were deprecated by RFC 8996 and are vulnerable to known attacks.`,
        remediation: "Disable TLS 1.0 and 1.1; allow only TLS 1.2 and TLS 1.3.",
        evidence: { host: target.host, enabled: legacyEnabled },
        references: ["https://www.rfc-editor.org/rfc/rfc8996"],
      });
    }

    return {
      observations: {
        reachable: true,
        protocol,
        cipher: cipher?.name,
        trusted: authorizationError === null,
        authorizationError,
        legacyProtocols: legacyEnabled,
        certificate: facts,
      },
      findings,
    };
  },
};
