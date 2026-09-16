import { describe, expect, it } from "vitest";
import { detectChanges } from "../scanner/changes.js";
import type { HttpResult } from "../scanner/http.js";
import { evaluateDmarc, evaluateSpf } from "../scanner/modules/email-security.js";
import { evaluateHeaders } from "../scanner/modules/headers.js";
import { detectTechnologies } from "../scanner/modules/tech.js";
import { evaluateCertificate, type CertFacts } from "../scanner/modules/tls.js";

const ids = (fs: Array<{ checkId: string }>) => fs.map((f) => f.checkId);

describe("SPF", () => {
  it("flags missing, multiple, +all and neutral policies", () => {
    expect(ids(evaluateSpf([]))).toEqual(["email.spf_missing"]);
    expect(ids(evaluateSpf(["v=spf1 -all", "v=spf1 ~all"]))).toEqual(["email.spf_multiple"]);
    expect(ids(evaluateSpf(["v=spf1 include:x +all"]))).toEqual(["email.spf_permissive"]);
    expect(ids(evaluateSpf(["v=spf1 include:x ?all"]))).toEqual(["email.spf_neutral"]);
    expect(ids(evaluateSpf(["v=spf1 include:x"]))).toEqual(["email.spf_neutral"]);
  });
  it("accepts enforcing policies", () => {
    expect(evaluateSpf(["google-site-verification=abc", "v=spf1 include:_spf.google.com ~all"])).toEqual([]);
    expect(evaluateSpf(["v=spf1 -all"])).toEqual([]);
  });
});

describe("DMARC", () => {
  it("flags missing and monitor-only", () => {
    expect(ids(evaluateDmarc([]))).toEqual(["email.dmarc_missing"]);
    expect(ids(evaluateDmarc(["v=DMARC1; p=none; rua=mailto:x@y.z"]))).toEqual(["email.dmarc_monitor_only"]);
  });
  it("accepts quarantine/reject", () => {
    expect(evaluateDmarc(["v=DMARC1; p=reject"])).toEqual([]);
    expect(evaluateDmarc(["v=DMARC1;p=quarantine;pct=100"])).toEqual([]);
  });
});

const res = (headers: HttpResult["headers"], body = ""): HttpResult => ({
  finalUrl: "https://example.com/", status: 200, headers, body, hops: [],
});

describe("security headers", () => {
  it("reports all missing headers on a bare response", () => {
    const found = ids(evaluateHeaders(res({}), true));
    expect(found).toEqual(expect.arrayContaining([
      "headers.hsts_missing", "headers.csp_missing", "headers.clickjacking", "headers.nosniff_missing", "headers.referrer_policy_missing",
    ]));
  });
  it("does not require HSTS over plain HTTP", () => {
    expect(ids(evaluateHeaders(res({}), false))).not.toContain("headers.hsts_missing");
  });
  it("passes a hardened response", () => {
    const found = evaluateHeaders(res({
      "strict-transport-security": "max-age=31536000",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      server: "nginx",
      "set-cookie": ["sid=1; Secure; HttpOnly; SameSite=Lax"],
    }), true);
    expect(found).toEqual([]);
  });
  it("flags version disclosure and weak cookies", () => {
    const found = ids(evaluateHeaders(res({ server: "Apache/2.4.41 (Ubuntu)", "x-powered-by": "PHP/7.4", "set-cookie": ["sid=1; path=/"] }), true));
    expect(found).toEqual(expect.arrayContaining(["headers.server_version", "headers.x_powered_by", "headers.cookie_flags"]));
  });
});

describe("technology detection", () => {
  it("identifies stack from headers and HTML", () => {
    const tech = detectTechnologies(res(
      { server: "nginx/1.25.3", "cf-ray": "abc" },
      '<html><head><meta name="generator" content="WordPress 6.4.2"></head><body><link href="/wp-content/x.css"></body></html>',
    ));
    const names = tech.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["nginx", "Cloudflare", "WordPress"]));
    expect(tech.find((t) => t.name === "nginx")?.version).toBe("1.25.3");
    expect(tech.find((t) => t.name === "WordPress")?.version).toBe("6.4.2");
  });
});

const cert = (daysRemaining: number, extra: Partial<CertFacts> = {}): CertFacts => ({
  subject: "CN=example.com", issuer: "CN=R3, O=Let's Encrypt", validFrom: "", validTo: "2030-01-01T00:00:00Z",
  daysRemaining, subjectAltNames: ["DNS:example.com"], selfSigned: false, fingerprint256: "AA", serialNumber: "01",
  keyType: "RSA", keyBits: 2048, ...extra,
});

describe("certificate evaluation", () => {
  it("grades expiry", () => {
    expect(evaluateCertificate(cert(-1), "example.com", "CERT_HAS_EXPIRED")[0]?.severity).toBe("CRITICAL");
    expect(evaluateCertificate(cert(5), "example.com", null)[0]?.severity).toBe("HIGH");
    expect(evaluateCertificate(cert(20), "example.com", null)[0]?.severity).toBe("MEDIUM");
    expect(evaluateCertificate(cert(80), "example.com", null)).toEqual([]);
  });
  it("reports trust problems and weak keys", () => {
    expect(ids(evaluateCertificate(cert(80), "a.example.com", "ERR_TLS_CERT_ALTNAME_INVALID"))).toEqual(["tls.hostname_mismatch"]);
    expect(ids(evaluateCertificate(cert(80, { selfSigned: true }), "example.com", "DEPTH_ZERO_SELF_SIGNED_CERT"))).toEqual(["tls.untrusted"]);
    expect(ids(evaluateCertificate(cert(80, { keyBits: 1024 }), "example.com", null))).toEqual(["tls.weak_key"]);
  });
});

describe("change detection", () => {
  it("ignores the first observation", () => {
    expect(detectChanges("dns", "example.com", null, { A: ["1.1.1.1"] })).toEqual([]);
  });
  it("detects DNS, port and certificate changes", () => {
    const dns = detectChanges("dns", "example.com", { A: ["1.1.1.1"], NS: ["a"] }, { A: ["1.1.1.2"], NS: ["a"] });
    expect(dns).toHaveLength(1);
    expect(dns[0]?.details).toMatchObject({ recordType: "A", added: ["1.1.1.2"], removed: ["1.1.1.1"] });

    const ports = detectChanges("ports", "h", { open: [{ port: 443 }] }, { open: [{ port: 443 }, { port: 3306 }] });
    expect(ports[0]).toMatchObject({ kind: "ports.new_open", severity: "HIGH" });

    const tls = detectChanges("tls", "h",
      { reachable: true, trusted: true, certificate: { fingerprint256: "A", issuer: "X" } },
      { reachable: true, trusted: false, certificate: { fingerprint256: "B", issuer: "Y" } });
    expect(tls.map((c) => c.kind)).toEqual(["tls.certificate_changed", "tls.trust_lost"]);
  });
});
