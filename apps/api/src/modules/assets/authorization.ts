import { promises as dns } from "node:dns";
import type { Asset, VerificationMethod } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { registrableDomain } from "../../lib/net.js";

export const TXT_PREFIX = "securescope-verification=";

/** Hostname carried by an asset, or null for IPs / OTHER. */
export function assetHost(asset: Pick<Asset, "type" | "value">): string | null {
  if (asset.type === "DOMAIN" || asset.type === "SUBDOMAIN") return asset.value;
  if (asset.type === "APPLICATION") {
    try {
      return new URL(asset.value).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

async function hasTxtToken(host: string, token: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(host);
    return records.some((r) => r.join("") === `${TXT_PREFIX}${token}`);
  } catch {
    return false;
  }
}

async function verifiedHostsInOrg(organizationId: string) {
  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      type: { in: ["DOMAIN", "SUBDOMAIN"] },
      authorizationStatus: "VERIFIED",
      verificationMethod: { in: ["DNS_TXT", "PARENT_DOMAIN"] },
    },
    select: { value: true, type: true },
  });
  return assets;
}

async function hasActiveAttestation(assetId: string): Promise<boolean> {
  const count = await prisma.assetAuthorization.count({
    where: { assetId, revokedAt: null, validUntil: { gt: new Date() } },
  });
  return count > 0;
}

/** Domain-level proof for a hostname: TXT on itself, or its registrable parent verified by TXT. */
async function proveHost(organizationId: string, host: string, token: string, selfId?: string) {
  if (await hasTxtToken(host, token)) return "DNS_TXT" as const;
  const parent = registrableDomain(host);
  if (parent && parent !== host) {
    const verifiedParent = await prisma.asset.findFirst({
      where: {
        organizationId,
        type: "DOMAIN",
        value: parent,
        authorizationStatus: "VERIFIED",
        verificationMethod: "DNS_TXT",
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (verifiedParent) return "PARENT_DOMAIN" as const;
  }
  return null;
}

/**
 * Determine whether the organization has proven control of (or permission for) an asset.
 * Returns the method that succeeded, or null.
 */
export async function establishAuthorization(asset: Asset): Promise<VerificationMethod | null> {
  const host = assetHost(asset);

  if (asset.type === "DOMAIN") {
    return (await hasTxtToken(asset.value, asset.verificationToken)) ? "DNS_TXT" : null;
  }

  if (host) {
    const method = await proveHost(asset.organizationId, host, asset.verificationToken, asset.id);
    if (method) return method;
  }

  if (asset.type === "IP_ADDRESS") {
    // An IP is in scope when a verified hostname of the same organization points at it.
    const hosts = await verifiedHostsInOrg(asset.organizationId);
    for (const h of hosts) {
      const [v4, v6] = await Promise.all([
        dns.resolve4(h.value).catch(() => [] as string[]),
        dns.resolve6(h.value).catch(() => [] as string[]),
      ]);
      if ([...v4, ...v6].includes(asset.value)) return "RESOLVES_FROM_VERIFIED";
    }
  }

  if (await hasActiveAttestation(asset.id)) return "ATTESTATION";
  return null;
}

export class ScanNotAuthorizedError extends Error {}

/**
 * Gate used by the scan engine right before any network probe. Re-validates
 * instead of trusting the stored status, so revoked TXT records, removed
 * parent domains or expired attestations stop scanning immediately.
 */
export async function assertScanAuthorized(asset: Asset): Promise<void> {
  if (asset.authorizationStatus !== "VERIFIED") {
    throw new ScanNotAuthorizedError("Asset ownership/authorization has not been verified");
  }
  const method = await establishAuthorization(asset);
  if (!method) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { authorizationStatus: "PENDING", verificationMethod: null, verifiedAt: null },
    });
    throw new ScanNotAuthorizedError(
      "Authorization could no longer be confirmed (verification record removed or attestation expired). Asset returned to pending.",
    );
  }
  if (method !== asset.verificationMethod) {
    await prisma.asset.update({ where: { id: asset.id }, data: { verificationMethod: method } });
  }
}
