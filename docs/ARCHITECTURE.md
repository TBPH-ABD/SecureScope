# SecureScope — Architecture

External attack-surface monitoring for small and mid-sized businesses.

## 1. Guiding principles

1. **Authorization before scanning.** No network probe is ever sent to an asset
   whose `authorizationStatus` is not `VERIFIED`. The gate lives in the scanner
   engine itself (`apps/api/src/scanner/engine.ts`), not only in the HTTP layer,
   so a job enqueued by any path is still refused.
2. **No fake results.** Every check performs real network I/O. A capability that
   needs a third-party service (breach data, e-mail delivery) is behind a
   provider interface; when unconfigured the UI shows "not configured" — never
   sample data.
3. **Least privilege everywhere.** RBAC is enforced server-side on every route
   through a single permission map (`apps/api/src/auth/permissions.ts`). The
   frontend only hides controls; it is never the enforcement point.
4. **Secrets stay server-side.** The browser talks only to `/api/*` (proxied by
   Next.js to the API). No keys are exposed through `NEXT_PUBLIC_*`.

## 2. System overview

```
 Browser ──HTTPS──▶ Next.js (apps/web) ──/api/* rewrite──▶ Fastify API (apps/api)
                                                              │
                                                              ├── PostgreSQL (Prisma)
                                                              │      ▲
                                                              │      │ pg-boss queue tables
                                                              ▼      │
                                                         Worker (apps/api/src/worker.ts)
                                                              │
                                        ┌─────────────────────┼─────────────────────┐
                                  Scanner modules       Breach provider       Notifier
                                  (dns, tls, headers,   (HIBP, optional)      (in-app, SMTP,
                                   ports, domain-config,                        webhook)
                                   tech)
```

* **apps/web** — Next.js (App Router) + TypeScript + Tailwind + TanStack Query +
  Recharts. Dark enterprise UI.
* **apps/api** — Fastify + TypeScript + Prisma + Zod. Same package provides two
  entry points: `server.ts` (HTTP) and `worker.ts` (background jobs).
* **Queue** — pg-boss (PostgreSQL-backed). No Redis needed; one less moving
  part for an SMB deployment.

## 3. Backend modules (`apps/api/src`)

| Module | Responsibility |
| --- | --- |
| `config/` | Env parsing with Zod — the process refuses to start on invalid config |
| `auth/` | Password hashing (argon2id), sessions, CSRF, RBAC permission map, guards |
| `modules/auth` | register / login / logout / me / invitation accept |
| `modules/dashboard` | aggregated score, counts, trend |
| `modules/assets` | CRUD, ownership verification (DNS TXT), authorization attestations |
| `modules/scans` | trigger scans, list runs, results |
| `modules/findings` | list/filter, status workflow, comments |
| `modules/reports` | generate report snapshots, PDF export |
| `modules/monitoring` | schedules, change events, notifications, breach monitors |
| `modules/team` | members, roles, invitations |
| `modules/audit` | audit log query |
| `scanner/` | engine + pluggable modules (`ScannerModule` interface) + scoring |
| `integrations/` | breach provider, mail/webhook notifier abstractions |
| `jobs/` | pg-boss wiring, job handlers |

### Scanner module contract

```ts
interface ScannerModule {
  id: string;                         // "dns", "tls", ...
  name: string;
  appliesTo: AssetType[];
  run(ctx: ScanContext): Promise<ModuleResult>;
}
interface ModuleResult {
  observations: Record<string, unknown>; // raw facts, stored per scan
  findings: FindingDraft[];              // normalized issues
}
```

Findings are de-duplicated by a stable `fingerprint` (`module:checkId:assetId[:detail]`).
Re-detection updates `lastSeenAt`; a finding no longer detected on a full scan is
auto-resolved (unless `ACCEPTED`), and a previously resolved one re-opens.

### Security score

`score = 100 − Σ penalty(open findings)` with per-severity weights
(critical 25, high 10, medium 4, low 1, info 0) and diminishing returns per
severity, clamped to 0–100. Grade A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F.
A snapshot is stored after every scan to draw the trend chart.

## 4. Authorization of assets

| Asset type | How it becomes `VERIFIED` |
| --- | --- |
| DOMAIN | DNS TXT record `securescope-verification=<token>` on the domain |
| SUBDOMAIN | Its registrable parent domain is verified in the same org, or its own TXT record |
| IP_ADDRESS | Resolves from a verified domain/subdomain in the org, **or** a signed attestation by an Owner (scope, authorizer, expiry) |
| APPLICATION (URL) | Host is a verified domain/subdomain in the org, or attestation |
| OTHER | Attestation only |

Attestations expire; expired → status returns to `PENDING` and scans stop.
Private/loopback/link-local/metadata IP ranges are always refused (SSRF guard),
and every DNS resolution made by a scanner is re-checked against that list.

## 5. Data model (PostgreSQL)

See `apps/api/prisma/schema.prisma` — the source of truth. Core tables:

```
Organization 1─* Membership *─1 User
Organization 1─* Asset 1─* Finding
Organization 1─* Scan 1─* ScanModuleRun
Asset 1─* AssetAuthorization (attestations)
Organization 1─* ScoreSnapshot
Organization 1─* Report
Organization 1─* MonitorSchedule, ChangeEvent, Notification
Organization 1─* BreachMonitor 1─* BreachExposure   (no credentials stored — ever)
Organization 1─* Invitation
Organization 1─* AuditLog
User 1─* Session
```

## 6. Security controls

| Control | Implementation |
| --- | --- |
| Password hashing | argon2id (memory 19 MiB, t=2) |
| Sessions | 256-bit random token in `HttpOnly; Secure; SameSite=Lax` cookie; only SHA-256 hash stored; idle + absolute expiry; rotation on login; revoke on logout / password change |
| CSRF | Per-session token, required in `X-CSRF-Token` for every state-changing request |
| Brute force | Global rate limit + stricter per-route limits on auth endpoints; account lockout after repeated failures |
| Input validation | Zod schemas on every body/query/param; hostnames/IPs normalized and validated |
| XSS | React escaping, no `dangerouslySetInnerHTML`, strict CSP via Helmet/Next headers |
| RBAC | `can(role, permission)` checked by `requirePermission()` pre-handler |
| Tenant isolation | Every query scoped by `organizationId` from the session, never from input |
| SSRF | Private-range blocklist + DNS re-validation in scanners |
| Audit | `audit.record()` on auth events, asset/finding/team/report changes, scans |
| Secrets | `.env` only; validated at boot; nothing sensitive in the web bundle |

## 7. Roles

| Permission | Owner | Security Admin | Analyst | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View dashboard / assets / findings / reports | ✔ | ✔ | ✔ | ✔ |
| Create/edit assets, verify ownership | ✔ | ✔ | — | — |
| Attest authorization (IP / other) | ✔ | — | — | — |
| Delete assets | ✔ | ✔ | — | — |
| Run scans | ✔ | ✔ | ✔ | — |
| Update findings (status, notes) | ✔ | ✔ | ✔ | — |
| Accept risk | ✔ | ✔ | — | — |
| Generate reports | ✔ | ✔ | ✔ | — |
| Manage monitoring & breach monitors | ✔ | ✔ | — | — |
| Manage team / invitations | ✔ | ✔ (not Owner role) | — | — |
| View audit log | ✔ | ✔ | — | — |
| Organization settings / transfer | ✔ | — | — | — |

## 8. Deployment

`docker compose up` starts `postgres`, `api`, `worker`, `web`. Migrations run
from the api container on start (`prisma migrate deploy`).
