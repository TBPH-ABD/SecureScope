import { describe, expect, it } from "vitest";
import { can, canAssignRole, outranks, PERMISSIONS, permissionsFor } from "../auth/permissions.js";

describe("RBAC", () => {
  it("owner holds every permission", () => {
    expect(permissionsFor("OWNER")).toEqual(Object.keys(PERMISSIONS));
  });

  it("viewer is read-only", () => {
    const perms = permissionsFor("VIEWER");
    expect(perms.every((p) => p.endsWith(":read"))).toBe(true);
    expect(can("VIEWER", "scans:run")).toBe(false);
    expect(can("VIEWER", "audit:read")).toBe(false);
    expect(can("VIEWER", "breach:read")).toBe(false);
  });

  it("analyst can triage but not administer", () => {
    expect(can("ANALYST", "scans:run")).toBe(true);
    expect(can("ANALYST", "findings:update")).toBe(true);
    expect(can("ANALYST", "findings:accept")).toBe(false);
    expect(can("ANALYST", "assets:write")).toBe(false);
    expect(can("ANALYST", "team:manage")).toBe(false);
  });

  it("only the owner can attest authorization", () => {
    expect(can("OWNER", "assets:attest")).toBe(true);
    expect(can("SECURITY_ADMIN", "assets:attest")).toBe(false);
  });

  it("admins cannot grant their own level or above", () => {
    expect(canAssignRole("SECURITY_ADMIN", "ANALYST")).toBe(true);
    expect(canAssignRole("SECURITY_ADMIN", "SECURITY_ADMIN")).toBe(false);
    expect(canAssignRole("SECURITY_ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(outranks("SECURITY_ADMIN", "OWNER")).toBe(false);
    expect(outranks("SECURITY_ADMIN", "VIEWER")).toBe(true);
  });
});
