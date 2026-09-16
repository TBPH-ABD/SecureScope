/**
 * End-to-end API tests against a real PostgreSQL database.
 * Run with: TEST_DATABASE_URL=postgresql://... npm test
 * (the schema must be migrated; the tests create uniquely-named records).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB = process.env.TEST_DATABASE_URL;
const suite = DB ? describe : describe.skip;

type Session = { cookie: string; csrf: string };

suite("API integration", () => {
  let app: FastifyInstance;
  const stamp = Date.now();
  const ownerEmail = `owner-${stamp}@example.com`;
  const password = "Correct-Horse-42";
  let owner: Session;

  const cookieFrom = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : [raw];
    return String(list.find((c) => String(c).startsWith("ss_session=")) ?? "").split(";")[0]!;
  };

  const login = async (cookie: string): Promise<Session> => {
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    return { cookie, csrf: me.json().csrfToken };
  };

  const call = (s: Session, method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie: s.cookie, "x-csrf-token": s.csrf } });

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Olivia Owner", email: ownerEmail, password, organizationName: `Acme ${stamp}` },
    });
    expect(res.statusCode).toBe(201);
    owner = await login(cookieFrom(res));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rejects weak passwords with field details", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "X Y", email: `weak-${stamp}@example.com`, password: "short", organizationName: "Org" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].path).toBe("password");
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/assets" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects writes without a CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { cookie: owner.cookie },
      payload: { type: "DOMAIN", value: "example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects cross-origin writes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, origin: "https://evil.example" },
      payload: { type: "DOMAIN", value: "example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not leak the session token or password hash", async () => {
    const me = await call(owner, "GET", "/api/auth/me");
    expect(me.body).not.toMatch(/passwordHash|tokenHash/);
  });

  it("refuses private and malformed asset values", async () => {
    for (const payload of [
      { type: "IP_ADDRESS", value: "10.0.0.5" },
      { type: "IP_ADDRESS", value: "169.254.169.254" },
      { type: "DOMAIN", value: "localhost" },
      { type: "DOMAIN", value: "www.example.com" },
      { type: "APPLICATION", value: "javascript:alert(1)" },
      { type: "APPLICATION", value: "https://user:pw@example.com" },
    ]) {
      const res = await call(owner, "POST", "/api/assets", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  let domainId: string;
  let ipId: string;

  it("creates unverified assets and blocks scanning them", async () => {
    const res = await call(owner, "POST", "/api/assets", { type: "DOMAIN", value: `securescope-test-${stamp}.com` });
    expect(res.statusCode).toBe(201);
    const asset = res.json();
    domainId = asset.id;
    expect(asset.authorizationStatus).toBe("PENDING");
    expect(asset.verification.txtRecordValue).toMatch(/^securescope-verification=/);

    const scan = await call(owner, "POST", "/api/scans", { assetId: domainId });
    expect(scan.statusCode).toBe(403);
    expect(scan.json().error.code).toBe("ASSET_NOT_AUTHORIZED");

    const verify = await call(owner, "POST", `/api/assets/${domainId}/verify`);
    expect(verify.json().verified).toBe(false);
  });

  it("allows only the owner to attest, and never for domains", async () => {
    const ip = await call(owner, "POST", "/api/assets", { type: "IP_ADDRESS", value: "8.8.4.4" });
    ipId = ip.json().id;
    const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const body = { authorizerName: "Hosting Co", scopeNote: "Contract #123 permits external scanning", validUntil, confirm: true };

    const forDomain = await call(owner, "POST", `/api/assets/${domainId}/attestations`, body);
    expect(forDomain.statusCode).toBe(400);

    const tooLong = await call(owner, "POST", `/api/assets/${ipId}/attestations`, { ...body, validUntil: new Date(Date.now() + 800 * 86_400_000).toISOString() });
    expect(tooLong.statusCode).toBe(400);

    const ok = await call(owner, "POST", `/api/assets/${ipId}/attestations`, body);
    expect(ok.statusCode).toBe(201);
    const detail = await call(owner, "GET", `/api/assets/${ipId}`);
    expect(detail.json().authorizationStatus).toBe("VERIFIED");
    expect(detail.json().verificationMethod).toBe("ATTESTATION");
  });

  let analyst: Session;
  let viewer: Session;

  it("invites members and enforces role boundaries", async () => {
    const mk = async (role: string, name: string) => {
      const inv = await call(owner, "POST", "/api/team/invitations", { email: `${role.toLowerCase()}-${stamp}@example.com`, role });
      expect(inv.statusCode).toBe(201);
      const token = new URL(inv.json().link).pathname.split("/").pop()!;
      const acc = await app.inject({ method: "POST", url: "/api/auth/invitations/accept", payload: { token, name, password } });
      expect(acc.statusCode).toBe(201);
      // A token can be redeemed once.
      const again = await app.inject({ method: "POST", url: "/api/auth/invitations/accept", payload: { token, name, password } });
      expect(again.statusCode).toBe(400);
      return login(cookieFrom(acc));
    };
    analyst = await mk("ANALYST", "Andy Analyst");
    viewer = await mk("VIEWER", "Vera Viewer");

    // Viewer: read yes, write no.
    expect((await call(viewer, "GET", "/api/assets")).statusCode).toBe(200);
    expect((await call(viewer, "POST", "/api/assets", { type: "DOMAIN", value: "viewer.com" })).statusCode).toBe(403);
    expect((await call(viewer, "POST", "/api/scans", { assetId: ipId })).statusCode).toBe(403);
    expect((await call(viewer, "GET", "/api/audit-logs")).statusCode).toBe(403);
    expect((await call(viewer, "GET", "/api/monitoring/breach-monitors")).statusCode).toBe(403);

    // Analyst: cannot manage assets, team or attest.
    expect((await call(analyst, "DELETE", `/api/assets/${ipId}`)).statusCode).toBe(403);
    expect((await call(analyst, "POST", "/api/team/invitations", { email: `x-${stamp}@example.com`, role: "VIEWER" })).statusCode).toBe(403);
    expect((await call(analyst, "GET", "/api/audit-logs")).statusCode).toBe(403);

    // Analyst does not receive the verification token.
    expect((await call(analyst, "GET", `/api/assets/${domainId}`)).json().verification).toBeNull();
  });

  it("keeps at least one owner", async () => {
    const team = (await call(owner, "GET", "/api/team")).json();
    const self = team.members.find((m: { isSelf: boolean }) => m.isSelf);
    expect((await call(owner, "PATCH", `/api/team/members/${self.id}`, { role: "VIEWER" })).statusCode).toBe(400);
    expect((await call(owner, "DELETE", `/api/team/members/${self.id}`)).statusCode).toBe(400);
  });

  it("isolates tenants", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Eve Other", email: `eve-${stamp}@example.com`, password, organizationName: `Other ${stamp}` },
    });
    const eve = await login(cookieFrom(other));
    expect((await call(eve, "GET", `/api/assets/${domainId}`)).statusCode).toBe(404);
    expect((await call(eve, "DELETE", `/api/assets/${domainId}`)).statusCode).toBe(404);
    expect((await call(eve, "POST", "/api/scans", { assetId: ipId })).statusCode).toBe(404);
    expect((await call(eve, "GET", "/api/assets")).json().total).toBe(0);
  });

  it("records the audit trail, including denied actions", async () => {
    const res = await call(owner, "GET", "/api/audit-logs?pageSize=100");
    const actions: string[] = res.json().items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.register", "asset.create", "asset.attest", "team.invite", "authz.denied", "scan.request"]));
  });

  it("generates a report and exports a PDF", async () => {
    const created = await call(analyst, "POST", "/api/reports", { title: "Quarterly review" });
    expect(created.statusCode).toBe(201);
    const pdf = await call(viewer, "GET", `/api/reports/${created.json().id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("locks the account after repeated failures", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `viewer-${stamp}@example.com`, password: "wrong-password" }, remoteAddress: `10.9.${i}.1` });
    }
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `viewer-${stamp}@example.com`, password }, remoteAddress: "10.9.9.9" });
    expect(res.statusCode).toBe(429);
  });

  it("logs out and invalidates the session", async () => {
    expect((await call(owner, "POST", "/api/auth/logout")).statusCode).toBe(200);
    expect((await call(owner, "GET", "/api/assets")).statusCode).toBe(401);
  });
});
