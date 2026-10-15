import { describe, expect, it } from "vitest";
import { formatAuMobile, normaliseAuMobile, pickMobile } from "./phone";

describe("normaliseAuMobile", () => {
  it.each([
    ["0412 345 678", "+61412345678"],
    ["0412345678", "+61412345678"],
    ["(04) 1234-5678", "+61412345678"],
    ["+61 412 345 678", "+61412345678"],
    ["+61 (0)412 345 678", "+61412345678"],
    ["61412345678", "+61412345678"],
    ["0061 412 345 678", "+61412345678"],
    ["412 345 678", "+61412345678"],
    [" 0499.888.777 ", "+61499888777"],
  ])("%s → %s", (raw, e164) => {
    expect(normaliseAuMobile(raw)).toEqual({ ok: true, e164 });
  });

  it.each([
    ["03 9123 4567", "Landline"],
    ["(02) 9876 5432", "Landline"],
    ["+61 3 9123 4567", "Landline"],
    ["9123 4567", "without area code"],
    ["1300 123 456", "1300"],
    ["1800 555 000", "1800"],
    ["13 13 13", "13 / 1300"],
    ["+44 7911 123456", "Not an Australian"],
    ["0412 345 67", "Not a valid"],
    ["call reception", "not a phone number"],
  ])("rejects %s", (raw, reason) => {
    const result = normaliseAuMobile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("explains a missing number", () => {
    expect(normaliseAuMobile(null)).toEqual({ ok: false, reason: "No phone number on file" });
    expect(normaliseAuMobile("  ")).toEqual({ ok: false, reason: "No phone number on file" });
  });
});

describe("pickMobile", () => {
  it("uses the first mobile among the candidates", () => {
    expect(pickMobile(["03 9123 4567", null, "0412 345 678"])).toEqual({
      ok: true,
      e164: "+61412345678",
      raw: "0412 345 678",
    });
  });

  it("reports why the first filled-in number failed", () => {
    expect(pickMobile([null, "03 9123 4567", "1300 000 000"])).toEqual({
      ok: false,
      reason: "Landline number, can't receive texts",
      raw: "03 9123 4567",
    });
    expect(pickMobile([null, ""])).toEqual({
      ok: false,
      reason: "No phone number on file",
      raw: null,
    });
  });
});

describe("formatAuMobile", () => {
  it("formats E.164 mobiles for people", () => {
    expect(formatAuMobile("+61412345678")).toBe("0412 345 678");
    expect(formatAuMobile("+4479")).toBe("+4479");
  });
});
