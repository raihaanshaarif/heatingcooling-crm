import { describe, expect, it } from "vitest";
import { SecretDecryptError, decryptSecret, encryptSecret } from "./crypto";
import * as xero from "./xero/crypto";

const secret = "test-auth-secret-0123456789abcdef";

describe("shared token encryption", () => {
  it("round-trips per context", () => {
    const blob = encryptSecret("ya29.token", secret, "coolops-google-calendar-tokens");
    expect(blob).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(decryptSecret(blob, secret, "coolops-google-calendar-tokens")).toBe("ya29.token");
  });

  it("keeps integrations apart: one context can't read another's tokens", () => {
    const blob = encryptSecret("ya29.token", secret, "coolops-google-calendar-tokens");
    expect(() => decryptSecret(blob, secret, "coolops-xero-tokens")).toThrow(SecretDecryptError);
    expect(() => xero.decryptSecret(blob, secret)).toThrow(xero.TokenDecryptError);
  });

  it("still reads Xero tokens stored before the helper was shared", () => {
    const blob = encryptSecret("xero-refresh", secret, "coolops-xero-tokens");
    expect(xero.decryptSecret(blob, secret)).toBe("xero-refresh");
    expect(decryptSecret(xero.encryptSecret("x", secret), secret, "coolops-xero-tokens")).toBe("x");
  });
});
