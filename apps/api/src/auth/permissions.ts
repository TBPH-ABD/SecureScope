import type { Role } from "@prisma/client";

/**
 * Single source of truth for authorization. Routes declare the permission they
 * need; nothing else in the codebase compares role names directly.
 */
export const PERMISSIONS = {
  "dashboard:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "assets:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "assets:write": ["OWNER", "SECURITY_ADMIN"],
  "assets:delete": ["OWNER", "SECURITY_ADMIN"],
  "assets:attest": ["OWNER"],
  "scans:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "scans:run": ["OWNER", "SECURITY_ADMIN", "ANALYST"],
  "findings:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "findings:update": ["OWNER", "SECURITY_ADMIN", "ANALYST"],
  "findings:accept": ["OWNER", "SECURITY_ADMIN"],
  "reports:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "reports:create": ["OWNER", "SECURITY_ADMIN", "ANALYST"],
  "reports:delete": ["OWNER", "SECURITY_ADMIN"],
  "monitoring:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "monitoring:manage": ["OWNER", "SECURITY_ADMIN"],
  "breach:read": ["OWNER", "SECURITY_ADMIN", "ANALYST"],
  "breach:manage": ["OWNER", "SECURITY_ADMIN"],
  "team:read": ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"],
  "team:manage": ["OWNER", "SECURITY_ADMIN"],
  "audit:read": ["OWNER", "SECURITY_ADMIN"],
  "org:manage": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

const RANK: Record<Role, number> = { OWNER: 4, SECURITY_ADMIN: 3, ANALYST: 2, VIEWER: 1 };

/** A manager may only grant/modify roles strictly below their own (Owner may grant anything). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  return RANK[actor] > RANK[target];
}

export function outranks(actor: Role, target: Role): boolean {
  return actor === "OWNER" || RANK[actor] > RANK[target];
}
