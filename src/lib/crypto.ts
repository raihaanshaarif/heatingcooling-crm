import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption at rest for OAuth tokens (Xero, Google Calendar): AES-256-GCM with a key
 * derived from AUTH_SECRET by HKDF-SHA256. Each integration passes its own `context` (the
 * HKDF salt) so a token stored for one can never be decrypted as another's.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * Changing AUTH_SECRET makes stored tokens unreadable: the integration then has to be
 * connected again.
 */
const VERSION = "v1";
const INFO = "aes-256-gcm";

export class SecretDecryptError extends Error {
  constructor(message = "Stored tokens can't be decrypted (was AUTH_SECRET changed?). Reconnect.") {
    super(message);
    this.name = "SecretDecryptError";
  }
}

export function deriveKey(secret: string, context: string): Buffer {
  if (!secret) throw new Error("AUTH_SECRET is required to encrypt stored tokens.");
  return Buffer.from(hkdfSync("sha256", secret, context, INFO, 32));
}

export function encryptSecret(plain: string, secret: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, context), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(blob: string, secret: string, context: string): string {
  const [version, iv, tag, ciphertext] = blob.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined)
    throw new SecretDecryptError();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret, context),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptError();
  }
}
