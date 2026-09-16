import { headerValue, type HttpResult } from "../http.js";
import type { ScannerModule } from "../types.js";

interface Signature {
  name: string;
  category: string;
  header?: [string, RegExp];
  body?: RegExp;
  cookie?: RegExp;
}

const SIGNATURES: Signature[] = [
  { name: "Cloudflare", category: "CDN", header: ["cf-ray", /./] },
  { name: "Amazon CloudFront", category: "CDN", header: ["x-amz-cf-id", /./] },
  { name: "Fastly", category: "CDN", header: ["x-served-by", /cache-/i] },
  { name: "Akamai", category: "CDN", header: ["x-akamai-transformed", /./] },
  { name: "Vercel", category: "Hosting", header: ["x-vercel-id", /./] },
  { name: "Netlify", category: "Hosting", header: ["x-nf-request-id", /./] },
  { name: "nginx", category: "Web server", header: ["server", /nginx/i] },
  { name: "Apache HTTP Server", category: "Web server", header: ["server", /apache/i] },
  { name: "Microsoft IIS", category: "Web server", header: ["server", /microsoft-iis/i] },
  { name: "LiteSpeed", category: "Web server", header: ["server", /litespeed/i] },
  { name: "PHP", category: "Language", header: ["x-powered-by", /php/i] },
  { name: "ASP.NET", category: "Framework", header: ["x-powered-by", /asp\.net/i] },
  { name: "Express", category: "Framework", header: ["x-powered-by", /express/i] },
  { name: "Next.js", category: "Framework", body: /__NEXT_DATA__|\/_next\/static\//i },
  { name: "Nuxt", category: "Framework", body: /__NUXT__|\/_nuxt\//i },
  { name: "React", category: "JavaScript library", body: /data-reactroot|react(-dom)?(\.production)?(\.min)?\.js/i },
  { name: "Angular", category: "Framework", body: /ng-version=/i },
  { name: "Vue.js", category: "Framework", body: /data-v-[0-9a-f]{8}|vue(\.runtime)?(\.min)?\.js/i },
  { name: "jQuery", category: "JavaScript library", body: /jquery[.-]?(\d[\d.]*)?(\.min)?\.js/i },
  { name: "WordPress", category: "CMS", body: /\/wp-content\/|\/wp-includes\//i },
  { name: "Drupal", category: "CMS", header: ["x-generator", /drupal/i] },
  { name: "Joomla", category: "CMS", body: /\/media\/jui\/|joomla/i },
  { name: "Shopify", category: "E-commerce", header: ["x-shopid", /./] },
  { name: "Magento", category: "E-commerce", cookie: /frontend=|mage-/i },
  { name: "Google Analytics", category: "Analytics", body: /googletagmanager\.com\/gtag|google-analytics\.com/i },
  { name: "Laravel", category: "Framework", cookie: /laravel_session/i },
  { name: "Django", category: "Framework", cookie: /csrftoken=/ },
];

export function detectTechnologies(res: HttpResult) {
  const detected = new Map<string, { name: string; category: string; version?: string; evidence: string }>();
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []).join("; ");
  for (const sig of SIGNATURES) {
    let evidence: string | undefined;
    if (sig.header) {
      const v = headerValue(res.headers, sig.header[0]);
      if (v && sig.header[1].test(v)) evidence = `${sig.header[0]}: ${v.slice(0, 120)}`;
    }
    if (!evidence && sig.body && sig.body.test(res.body)) evidence = `HTML matches ${sig.body.source.slice(0, 60)}`;
    if (!evidence && sig.cookie && sig.cookie.test(cookies)) evidence = "cookie name";
    if (evidence) detected.set(sig.name, { name: sig.name, category: sig.category, evidence });
  }
  const generator = res.body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,100})["']/i)?.[1];
  if (generator) {
    const name = generator.replace(/\s*[\d.]+.*$/, "") || generator;
    detected.set(name, { name, category: "Generator", version: generator.match(/[\d.]+/)?.[0], evidence: `meta generator: ${generator}` });
  }
  const server = headerValue(res.headers, "server");
  const version = server?.match(/\/([\d.]+)/)?.[1];
  for (const t of detected.values()) {
    if (!t.version && version && server!.toLowerCase().includes(t.name.split(" ")[0]!.toLowerCase())) t.version = version;
  }
  return [...detected.values()];
}

export const techModule: ScannerModule = {
  id: "tech",
  name: "Technology Detection",
  description: "Passive fingerprinting of web servers, frameworks and services from headers and HTML.",
  appliesTo: ["DOMAIN", "SUBDOMAIN", "IP_ADDRESS", "APPLICATION"],
  async run(ctx) {
    const page = await ctx.homepage();
    const res = page.https ?? page.http;
    if (!res) return { observations: { reachable: false, technologies: [] }, findings: [] };
    const title = res.body.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1]?.trim();
    const technologies = detectTechnologies(res);
    const findings = technologies
      .filter((t) => t.name === "WordPress" || t.category === "Generator")
      .filter((t) => t.version)
      .map((t) => ({
        checkId: "tech.version_disclosure",
        detail: t.name,
        title: `${t.name} version disclosed`,
        severity: "LOW" as const,
        description: `The page reveals ${t.name} ${t.version}. Version disclosure lets attackers match the site against known vulnerabilities.`,
        remediation: "Remove the generator meta tag / version strings and keep the platform patched.",
        evidence: { url: res.finalUrl, technology: t },
      }));
    return { observations: { url: res.finalUrl, title, technologies }, findings };
  },
};
