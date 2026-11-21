import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { Secret, TOTP } from "otpauth";
import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordSchema = z.string().min(12).max(1024);
export const passwordInputSchema = z.string().min(1).max(1024);
export const codeSchema = z.string().regex(/^(?:[0-9]{6}|[a-f0-9]{20})$/);
export const credentialSchema = z.string().min(32).max(1024);
export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const generateRecoveryCodes = () =>
  Array.from({ length: 10 }, () => randomBytes(10).toString("hex"));

export const hashPassword = (password: string) =>
  hash(passwordSchema.parse(password), {
    // Argon2id is the library's default algorithm.
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });

export function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return verify(encoded, passwordInputSchema.parse(password));
}

export function createTotp(secret: string, label: string) {
  return new TOTP({
    issuer: "Atlas",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function newTotp(label: string) {
  const secret = new Secret({ size: 20 }).base32;
  return { secret, uri: createTotp(secret, label).toString() };
}

export function totpCounter(secret: string, token: string, timestamp: number): number | null {
  if (!/^[0-9]{6}$/.test(token)) return null;
  const delta = createTotp(secret, "Atlas").validate({ token, timestamp, window: 1 });
  return delta === null ? null : Math.floor(timestamp / 30_000) + delta;
}

const claims = z.object({ sub: z.uuid(), sid: z.uuid(), site: z.uuid(), tenant: z.uuid() });
export type AccessClaims = z.infer<typeof claims>;
const keyId = "atlas-v1";
const audience = "atlas:rest";

export function createCredentials(secret: Buffer, issuer: string, clock: () => Date) {
  function key(context: string) {
    return Buffer.from(hkdfSync("sha256", secret, "", context, 32));
  }
  const access = key("atlas/access");
  const encryption = key("atlas/identity-encryption");

  return {
    async sign(data: AccessClaims): Promise<string> {
      const now = Math.floor(clock().getTime() / 1000);
      return new SignJWT({ sid: data.sid, site: data.site, tenant: data.tenant })
        .setProtectedHeader({ alg: "HS256", typ: "at+jwt", kid: keyId })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(data.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(access);
    },
    async verify(token: string): Promise<AccessClaims> {
      const { payload, protectedHeader } = await jwtVerify(token, access, {
        algorithms: ["HS256"],
        issuer,
        audience,
        typ: "at+jwt",
        requiredClaims: ["exp", "iat"],
        currentDate: clock(),
      });
      if (protectedHeader.kid !== keyId) throw new Error("Unknown authorization key.");
      return claims.parse(payload);
    },
    encrypt(value: string, context: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryption, iv);
      cipher.setAAD(Buffer.from(context));
      return Buffer.concat([
        iv,
        cipher.update(value, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64url");
    },
    decrypt(value: string, context: string): string {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.length < 28) throw new Error("Invalid encrypted data.");
      const decipher = createDecipheriv("aes-256-gcm", encryption, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}
