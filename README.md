# SecureScope

External attack-surface monitoring for small and mid-sized businesses: one dashboard
for the security posture of your domains, subdomains, IPs and web applications.

> **Authorization first.** SecureScope never sends a probe to an asset unless the
> organization has proven it owns it (DNS TXT record / verified parent domain /
> resolves from a verified host) or an Owner has recorded a time-limited written
> authorization. The check is repeated inside the scan engine before every scan.

## Features

| Area | What it does |
| --- | --- |
| Dashboard | Security score (0–100, A–F), severity breakdown, open issues, recent scans, score trend, recent changes |
| Asset management | Domains, subdomains, IPs, applications, other; ownership verification and authorization records |
| Domain scanner | DNS records & dangling CNAMEs · SPF / DMARC / MTA-STS · TLS certificate, trust, expiry, legacy protocols · HTTP security headers & cookies · exposed services (TCP connect on a configurable port list) · technology fingerprinting |
| Findings | Severity, affected asset, evidence, description, remediation, status workflow (Open / In Progress / Resolved / Accepted), assignee, comments, history. Auto-resolve when no longer detected, re-open on reappearance |
| Reports | Frozen snapshots with executive summary, risk level, affected assets, prioritized recommendations; PDF export |
| Monitoring | Scheduled re-scans, change detection (DNS, certificates, ports, mail policy, tech stack), in-app / e-mail / webhook alerts |
| Breach monitoring | Company e-mail domains checked against known breaches (Have I Been Pwned). Addresses are masked; **credentials are never requested, stored or shown** |
| Team & RBAC | Owner, Security Administrator, Analyst, Viewer — enforced server-side on every route |
| Audit log | Actor, action, resource, outcome, IP, timestamp — including denied and failed attempts |

## Architecture

```
apps/web   Next.js 15 (App Router) · TypeScript · Tailwind · TanStack Query · Recharts
apps/api   Fastify 5 · Prisma 6 · PostgreSQL · pg-boss (jobs) · Zod · argon2 · pdfkit
           ├─ src/server.ts   HTTP API
           └─ src/worker.ts   background scans, monitoring schedule, breach checks
```

Full design, data model, security controls and the permission matrix are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Adding a scanner check

1. Create `apps/api/src/scanner/modules/<name>.ts` implementing `ScannerModule`
   (`id`, `name`, `appliesTo`, `run(ctx)` → `{ observations, findings }`).
2. Register it in `apps/api/src/scanner/modules/index.ts`.
3. Use `ctx.addresses` / `ctx.homepage()` — they are already SSRF-validated.
   Optionally teach `scanner/changes.ts` which observation changes matter.

### External services

| Service | Env vars | When unset |
| --- | --- | --- |
| Have I Been Pwned (breach data) | `HIBP_API_KEY`, `HIBP_USER_AGENT` | Breach monitoring shows “not configured”; no data is fabricated |
| SMTP (alerts, invitations) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | In-app notifications only; invitation links are shown once to the admin |

Providers live behind interfaces in `apps/api/src/integrations/` so they can be swapped.

## Running locally

Requirements: Node 20+, PostgreSQL 14+.

```bash
cp .env.example .env            # set DATABASE_URL
npm install
npm run db:migrate -w apps/api  # create schema
npm run dev:api                 # http://localhost:4000
npm run dev:worker              # scan / monitoring worker
npm run dev:web                 # http://localhost:3000
```

Open http://localhost:3000/register to create the first organization (you become its Owner).

## Docker

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
# For local testing over plain HTTP only:
echo "COOKIE_SECURE=false" >> .env
docker compose up --build
```

`migrate` applies migrations, then `api`, `worker` and `web` start. PostgreSQL and the API
sit on an internal network; only `web` (port 3000) is published. In production put a TLS
reverse proxy in front of `web`, keep `COOKIE_SECURE=true`, and set `APP_ORIGIN` to the public URL.

## Tests

```bash
npm test                                             # unit tests
TEST_DATABASE_URL=postgresql://... npm test          # + API integration tests (migrated DB)
npm run typecheck
```

## Security notes

- Passwords: argon2id; 12+ chars with mixed case and digits; lockout after 5 failures.
- Sessions: opaque random token in an `HttpOnly`, `SameSite=Lax` (and `Secure`) cookie, stored hashed;
  idle and absolute expiry; all other sessions revoked on password change.
- CSRF: per-session token required in `X-CSRF-Token` for every write, plus an Origin check.
- Rate limits: global and stricter per-route limits (auth, scans, reports, verification).
- CSP: nonce-based on the web app; `default-src 'none'` on the API.
- SSRF: private, loopback, link-local, CGNAT, multicast and documentation ranges are refused at
  input time, at resolution time and at socket-connect time (redirects included).
- Tenant isolation: every query is scoped by the organization from the session.

## License

Proprietary — all rights reserved.
