import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the Xero OAuth tokens: AES-256-GCM with a key derived from
 * AUTH_SECRET by HKDF-SHA256. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * Changing AUTH_SECRET makes stored tokens unreadable: the admin then reconnects Xero.
 */
const VERSION = "v1";
const SALT = "coolops-xero-tokens";
const INFO = "aes-256-gcm";

export class TokenDecryptError extends Error {
  constructor() {
    super("Stored Xero tokens can't be decrypted (was AUTH_SECRET changed?). Reconnect Xero.");
    this.name = "TokenDecryptError";
  }
}

export function deriveKey(secret: string): Buffer {
  if (!secret) throw new Error("AUTH_SECRET is required to encrypt Xero tokens.");
  return Buffer.from(hkdfSync("sha256", secret, SALT, INFO, 32));
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(blob: string, secret: string): string {
  const [version, iv, tag, ciphertext] = blob.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new TokenDecryptError();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenDecryptError();
  }
}
