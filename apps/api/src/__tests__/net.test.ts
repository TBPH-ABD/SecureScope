import { describe, expect, it } from "vitest";
import { isNonPublicIp, normalizeHostname, normalizeIp, registrableDomain, resolvePublicAddresses } from "../lib/net.js";

describe("isNonPublicIp", () => {
  it.each([
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "172.31.255.255", "192.168.1.1",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "2001:db8::1",
  ])("blocks %s", (ip) => expect(isNonPublicIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => expect(isNonPublicIp(ip)).toBe(false),
  );

  it("treats garbage as non-public", () => expect(isNonPublicIp("not-an-ip")).toBe(true));
});

describe("normalizeHostname", () => {
  it("lower-cases and strips trailing dot", () => expect(normalizeHostname("WWW.Example.COM.")).toBe("www.example.com"));
  it.each(["localhost", "intranet", "foo.local", "foo.internal", "-bad.example.com", "exa mple.com", "http://example.com", "1.2.3.4", "com"])(
    "rejects %s",
    (h) => expect(normalizeHostname(h)).toBeNull(),
  );
  it("accepts multi-level public suffixes", () => expect(normalizeHostname("shop.example.co.uk")).toBe("shop.example.co.uk"));
});

describe("registrableDomain", () => {
  it("finds the registrable parent", () => {
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com")).toBe("example.com");
  });
});

describe("normalizeIp", () => {
  it("validates addresses", () => {
    expect(normalizeIp(" 8.8.8.8 ")).toBe("8.8.8.8");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("2606:4700::1111")).toBe("2606:4700::1111");
  });
});

describe("resolvePublicAddresses", () => {
  it("refuses literal private addresses without any network I/O", async () => {
    await expect(resolvePublicAddresses("127.0.0.1")).rejects.toThrow(/not a public address/);
    await expect(resolvePublicAddresses("169.254.169.254")).rejects.toThrow();
  });
  it("passes public literals through", async () => {
    await expect(resolvePublicAddresses("8.8.8.8")).resolves.toEqual(["8.8.8.8"]);
  });
});
