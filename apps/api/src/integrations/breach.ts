import { env } from "../config/env.js";

export interface BreachRecord {
  name: string;
  title: string;
  breachDate: string | null;
  dataClasses: string[];
}

export interface DomainExposure {
  email: string;
  breaches: string[];
}

export interface BreachProvider {
  readonly id: string;
  readonly configured: boolean;
  searchDomain(domain: string): Promise<DomainExposure[]>;
  breachDetails(name: string): Promise<BreachRecord | null>;
}

export class BreachProviderNotConfigured extends Error {
  constructor() {
    super("No breach intelligence provider is configured. Set HIBP_API_KEY to enable breach monitoring.");
  }
}

const HIBP = "https://haveibeenpwned.com/api/v3";

/**
 * Have I Been Pwned domain search. HIBP only returns which aliases appear in
 * which breaches — never passwords — and requires the domain to be verified
 * in the HIBP dashboard for the key's owner.
 */
class HibpProvider implements BreachProvider {
  readonly id = "hibp";
  readonly configured = true;
  private cache = new Map<string, BreachRecord | null>();

  private async get(path: string, auth: boolean): Promise<Response> {
    return fetch(`${HIBP}${path}`, {
      headers: {
        "user-agent": env.HIBP_USER_AGENT,
        ...(auth ? { "hibp-api-key": env.HIBP_API_KEY! } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async searchDomain(domain: string): Promise<DomainExposure[]> {
    const res = await this.get(`/breacheddomain/${encodeURIComponent(domain)}`, true);
    if (res.status === 404) return [];
    if (res.status === 401 || res.status === 403) {
      throw new Error("HIBP rejected the request: check the API key and that the domain is verified in your HIBP dashboard");
    }
    if (res.status === 429) throw new Error("HIBP rate limit reached; will retry on the next cycle");
    if (!res.ok) throw new Error(`HIBP returned HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, string[]>;
    return Object.entries(body).map(([alias, breaches]) => ({ email: `${alias}@${domain}`, breaches }));
  }

  async breachDetails(name: string): Promise<BreachRecord | null> {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const res = await this.get(`/breach/${encodeURIComponent(name)}`, false);
    let record: BreachRecord | null = null;
    if (res.ok) {
      const b = (await res.json()) as { Name: string; Title: string; BreachDate?: string; DataClasses?: string[] };
      record = { name: b.Name, title: b.Title, breachDate: b.BreachDate ?? null, dataClasses: b.DataClasses ?? [] };
    }
    this.cache.set(name, record);
    return record;
  }
}

class UnconfiguredProvider implements BreachProvider {
  readonly id = "none";
  readonly configured = false;
  async searchDomain(): Promise<DomainExposure[]> {
    throw new BreachProviderNotConfigured();
  }
  async breachDetails() {
    return null;
  }
}

export const breachProvider: BreachProvider = env.HIBP_API_KEY ? new HibpProvider() : new UnconfiguredProvider();

/** "jane.doe@example.com" → "j*******@example.com" */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}
