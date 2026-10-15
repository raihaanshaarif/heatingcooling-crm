import { describe, expect, it } from "vitest";
import { TokenDecryptError, decryptSecret, encryptSecret } from "./crypto";

const secret = "test-auth-secret-0123456789abcdef";

describe("Xero token encryption", () => {
  it("round-trips a token", () => {
    const token = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgx";
    const blob = encryptSecret(token, secret);
    expect(blob).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(blob).not.toContain(token);
    expect(decryptSecret(blob, secret)).toBe(token);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same", secret)).not.toBe(encryptSecret("same", secret));
  });

  it("fails with the wrong AUTH_SECRET", () => {
    const blob = encryptSecret("refresh-token", secret);
    expect(() => decryptSecret(blob, "another-secret")).toThrow(TokenDecryptError);
  });

  it("detects tampering", () => {
    const [v, iv, tag, ct] = encryptSecret("refresh-token", secret).split(".");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), secret),
    ).toThrow(TokenDecryptError);
    expect(() => decryptSecret("not-a-blob", secret)).toThrow(TokenDecryptError);
  });

  it("refuses to work without a secret", () => {
    expect(() => encryptSecret("x", "")).toThrow(/AUTH_SECRET/);
  });
});
