import { describe, expect, it } from "vitest";
import { can, type Principal } from "../src/access.js";
import {
  createCredentials,
  createTotp,
  hashPassword,
  newTotp,
  totpCounter,
  verifyPassword,
} from "../src/crypto.js";

describe("credentials", () => {
  it("uses Argon2id and rejects the wrong password", async () => {
    const digest = await hashPassword("test password example");
    expect(digest).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(digest, "test password example")).toBe(true);
    expect(await verifyPassword(digest, "wrong")).toBe(false);
  });

  it("validates token audience, issuer and expiry, and binds encryption context", async () => {
    const secret = Buffer.alloc(32, 17);
    const claimId = "d26afd90-96f2-4bc5-95b2-d8b48bc7654f";
    let now = new Date("2026-01-01T00:00:00Z");
    const credentials = createCredentials(secret, "https://atlas.test", () => now);
    const token = await credentials.sign({
      sub: claimId,
      sid: claimId,
      site: claimId,
      tenant: claimId,
    });
    expect((await credentials.verify(token)).sub).toBe(claimId);
    await expect(
      createCredentials(secret, "https://other.test", () => now).verify(token),
    ).rejects.toThrow();
    now = new Date(now.getTime() + 301_000);
    await expect(credentials.verify(token)).rejects.toThrow();
    const encoded = credentials.encrypt("example", "factor:a");
    expect(credentials.decrypt(encoded, "factor:a")).toBe("example");
    expect(() => credentials.decrypt(encoded, "factor:b")).toThrow();
  });

  it("accepts a valid TOTP in the neighboring step", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const { secret } = newTotp("test");
    const code = createTotp(secret, "test").generate({ timestamp: start });
    expect(totpCounter(secret, code, start + 30_000)).toBe(Math.floor(start / 30_000));
    expect(totpCounter(secret, code, start + 90_000)).toBeNull();
  });
});

describe("resource policy", () => {
  const author: Principal = {
    userId: "a",
    siteId: "s",
    tenantId: "t",
    capabilities: new Set(["content.post.edit"]),
  };
  it("checks site, ownership and publishing rights", () => {
    expect(can(author, "edit", { siteId: "s", ownerId: "a", status: "draft" })).toBe(true);
    expect(can(author, "edit", { siteId: "other", ownerId: "a" })).toBe(false);
    expect(can(author, "edit", { siteId: "s", ownerId: "b" })).toBe(false);
    expect(can(author, "edit", { siteId: "s", ownerId: "a", status: "published" })).toBe(false);
    expect(
      can({ ...author, capabilities: new Set(["content.post.edit-any"]) }, "edit", {
        siteId: "s",
        ownerId: "b",
      }),
    ).toBe(true);
  });
});
