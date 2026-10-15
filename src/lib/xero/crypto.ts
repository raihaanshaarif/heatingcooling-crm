import * as shared from "@/lib/crypto";

/**
 * Xero token encryption: the shared AES-256-GCM helper in src/lib/crypto.ts with Xero's own
 * key context (unchanged, so tokens stored before the move still decrypt).
 */
const CONTEXT = "coolops-xero-tokens";

export class TokenDecryptError extends shared.SecretDecryptError {
  constructor() {
    super("Stored Xero tokens can't be decrypted (was AUTH_SECRET changed?). Reconnect Xero.");
    this.name = "TokenDecryptError";
  }
}

export function deriveKey(secret: string): Buffer {
  return shared.deriveKey(secret, CONTEXT);
}

export function encryptSecret(plain: string, secret: string): string {
  return shared.encryptSecret(plain, secret, CONTEXT);
}

export function decryptSecret(blob: string, secret: string): string {
  try {
    return shared.decryptSecret(blob, secret, CONTEXT);
  } catch (error) {
    if (error instanceof shared.SecretDecryptError) throw new TokenDecryptError();
    throw error;
  }
}
