import { headerValue, type HttpResult } from "../http.js";
import type { FindingDraft, ScannerModule } from "../types.js";

const REF_HEADERS = "https://owasp.org/www-project-secure-headers/";

export function evaluateHeaders(res: HttpResult, isHttps: boolean): FindingDraft[] {
  const h = res.headers;
  const url = res.finalUrl;
  const findings: FindingDraft[] = [];
  const missing = (checkId: string, header: string, severity: FindingDraft["severity"], why: string, fix: string) =>
    findings.push({
      checkId,
      title: `Missing ${header} header`,
      severity,
      description: why,
      remediation: fix,
      evidence: { url, status: res.status, header, value: null },
      references: [REF_HEADERS],
    });

  const csp = headerValue(h, "content-security-policy");
  if (isHttps && !headerValue(h, "strict-transport-security")) {
    missing("headers.hsts_missing", "Strict-Transport-Security", "MEDIUM",
      "Without HSTS, a network attacker can downgrade the first visit to plain HTTP and intercept traffic.",
      "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.");
  }
  if (!csp) {
    missing("headers.csp_missing", "Content-Security-Policy", "MEDIUM",
      "A Content Security Policy limits the impact of cross-site scripting by restricting where scripts may load from.",
      "Define a restrictive `Content-Security-Policy`, starting with `default-src 'self'` and tightening per application.");
  }
  if (!headerValue(h, "x-frame-options") && !/frame-ancestors/i.test(csp ?? "")) {
    missing("headers.clickjacking", "X-Frame-Options", "LOW",
      "The page can be embedded in a frame on any site, which enables clickjacking.",
      "Add `X-Frame-Options: DENY` or the CSP directive `frame-ancestors 'none'`.");
  }
  if (headerValue(h, "x-content-type-options")?.toLowerCase() !== "nosniff") {
    missing("headers.nosniff_missing", "X-Content-Type-Options", "LOW",
      "Browsers may MIME-sniff responses and execute content with an unintended type.",
      "Add `X-Content-Type-Options: nosniff`.");
  }
  if (!headerValue(h, "referrer-policy")) {
    missing("headers.referrer_policy_missing", "Referrer-Policy", "INFO",
      "Full URLs, which may contain sensitive parameters, can leak to third-party sites through the Referer header.",
      "Add `Referrer-Policy: strict-origin-when-cross-origin`.");
  }

  const server = headerValue(h, "server");
  if (server && /\d/.test(server)) {
    findings.push({
      checkId: "headers.server_version",
      title: "Server version disclosed",
      severity: "LOW",
      description: `The Server header reveals software and version (${server}), helping attackers select exploits.`,
      remediation: "Configure the web server to omit version details (e.g. `server_tokens off` in nginx, `ServerTokens Prod` in Apache).",
      evidence: { url, server },
    });
  }
  const poweredBy = headerValue(h, "x-powered-by");
  if (poweredBy) {
    findings.push({
      checkId: "headers.x_powered_by",
      title: "X-Powered-By header discloses technology",
      severity: "LOW",
      description: `The response advertises "${poweredBy}".`,
      remediation: "Remove the X-Powered-By header in the application or proxy configuration.",
      evidence: { url, xPoweredBy: poweredBy },
    });
  }

  const cookies = h["set-cookie"];
  const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  const weak = list
    .map((c) => ({ name: c.split("=")[0]!.trim(), secure: /;\s*secure/i.test(c), httpOnly: /;\s*httponly/i.test(c) }))
    .filter((c) => (isHttps && !c.secure) || !c.httpOnly);
  if (weak.length > 0) {
    findings.push({
      checkId: "headers.cookie_flags",
      title: "Cookies set without Secure/HttpOnly flags",
      severity: "LOW",
      description: "Cookies lacking `Secure` can be sent over HTTP; cookies lacking `HttpOnly` are readable by JavaScript and exposed to XSS. Review whether these are session cookies.",
      remediation: "Set `Secure`, `HttpOnly` and an appropriate `SameSite` attribute on session and authentication cookies.",
      evidence: { url, cookies: weak },
    });
  }
  return findings;
}

export const headersModule: ScannerModule = {
  id: "headers",
  name: "HTTP Security Headers",
  description: "Fetches the web root and evaluates security headers, cookie flags and HTTPS redirection.",
  appliesTo: ["DOMAIN", "SUBDOMAIN", "IP_ADDRESS", "APPLICATION"],
  async run(ctx) {
    const page = await ctx.homepage();
    const primary = page.https ?? page.http;
    if (!primary) {
      return { observations: { reachable: false, httpsError: page.httpsError, httpError: page.httpError }, findings: [] };
    }
    const finalIsHttps = primary.finalUrl.startsWith("https:");
    const findings = evaluateHeaders(primary, finalIsHttps);

    if (page.http && !page.http.finalUrl.startsWith("https:") && page.https) {
      findings.push({
        checkId: "headers.no_https_redirect",
        title: "HTTP does not redirect to HTTPS",
        severity: "MEDIUM",
        description: "The site is served over plain HTTP without redirecting to HTTPS, so users who type the bare hostname are not protected.",
        remediation: "Redirect all HTTP requests to HTTPS with a 301 and enable HSTS.",
        evidence: { hops: page.http.hops.map((x) => ({ url: x.url, status: x.status })) },
      });
    }
    if (!page.https && page.http) {
      findings.push({
        checkId: "headers.http_only",
        title: "Website served only over unencrypted HTTP",
        severity: "HIGH",
        description: "The web service is available over HTTP but not HTTPS; all traffic, including credentials, can be intercepted.",
        remediation: "Deploy a trusted TLS certificate, serve over HTTPS and redirect HTTP to HTTPS.",
        evidence: { url: page.http.finalUrl, httpsError: page.httpsError },
      });
    }

    const pick = (r: typeof primary) => ({
      finalUrl: r.finalUrl,
      status: r.status,
      redirects: r.hops.map((x) => ({ url: x.url, status: x.status })),
      headers: Object.fromEntries(
        Object.entries(r.headers).filter(([k]) => k !== "set-cookie").map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      ),
    });
    return {
      observations: {
        reachable: true,
        https: page.https ? pick(page.https) : null,
        http: page.http ? pick(page.http) : null,
      },
      findings,
    };
  },
};
