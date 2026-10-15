import { describe, expect, it } from "vitest";
import { countSegments, normaliseSmsText } from "./segments";
import { renderSms, resolveSmsSettings, greetingName, DEFAULT_SMS_TEMPLATES } from "./templates";
import { renderTemplate } from "@/lib/template";

describe("countSegments", () => {
  it("counts plain GSM text: 160 per SMS, 153 per part when split", () => {
    expect(countSegments("")).toMatchObject({ segments: 0, length: 0, remaining: 160 });
    expect(countSegments("a".repeat(160))).toMatchObject({
      encoding: "GSM-7",
      segments: 1,
      remaining: 0,
    });
    expect(countSegments("a".repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
    expect(countSegments("a".repeat(306))).toMatchObject({ segments: 2, remaining: 0 });
    expect(countSegments("a".repeat(307))).toMatchObject({ segments: 3 });
  });

  it("counts GSM extension characters as two", () => {
    expect(countSegments("€10 [today]").length).toBe(14);
    expect(countSegments("{".repeat(80))).toMatchObject({ length: 160, segments: 1 });
    expect(countSegments("{".repeat(81))).toMatchObject({ length: 162, segments: 2 });
  });

  it("switches to UCS-2 (70 / 67) for emoji and other characters", () => {
    const smile = String.fromCodePoint(0x1f600);
    const info = countSegments(`Hi ${smile}`);
    expect(info.encoding).toBe("UCS-2");
    expect(info.length).toBe(5); // emoji is two UTF-16 units
    expect(info.unicodeChars).toEqual([smile]);
    expect(countSegments("ā".repeat(70)).segments).toBe(1);
    expect(countSegments("ā".repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(countSegments("ā".repeat(135)).segments).toBe(3);
  });

  it("treats Australian $ amounts, newlines and accents in GSM as single characters", () => {
    expect(countSegments("Total $385.00\nThanks é").encoding).toBe("GSM-7");
  });
});

describe("normaliseSmsText", () => {
  it("replaces smart punctuation so the text stays GSM", () => {
    const smart = `It${String.fromCharCode(0x2019)}s ${String.fromCharCode(0x201c)}done${String.fromCharCode(0x201d)} ${String.fromCharCode(0x2013)} ok${String.fromCharCode(0x2026)}`;
    const out = normaliseSmsText(smart);
    expect(out).toBe(`It's "done" - ok...`);
    expect(countSegments(out).encoding).toBe("GSM-7");
  });

  it("trims and collapses blank lines", () => {
    expect(normaliseSmsText("  Hi\n\n\n\nThere  \n")).toBe("Hi\n\nThere");
  });
});

describe("SMS templates", () => {
  it("renders {{placeholders}} like email templates; unknown ones are blank", () => {
    expect(renderTemplate("Hi {{ clientName }}, {{nope}}!", { clientName: "Sarah" })).toBe(
      "Hi Sarah, !",
    );
    expect(
      renderSms("Hi {{clientName}}  {{missing}} from {{businessName}}.", {
        clientName: "Sarah",
        businessName: "CSM",
      }),
    ).toBe("Hi Sarah from CSM.");
  });

  it("default on-my-way text fits in one SMS with typical details", () => {
    const text = renderSms(DEFAULT_SMS_TEMPLATES.onMyWay, {
      clientName: "Sarah",
      techName: "Jack",
      businessName: "Cooling Service Melbourne",
      businessPhone: "(03) 9000 1234",
    });
    expect(text).toContain("Jack from Cooling Service Melbourne");
    expect(countSegments(text).segments).toBe(1);
  });

  it("falls back to defaults for missing or blank stored settings", () => {
    const s = resolveSmsSettings({
      enabled: { invoiceOverdue: true, onMyWay: "yes" },
      templates: { onMyWay: "  ", general: "Hello {{clientName}}" },
    });
    expect(s.enabled).toEqual({
      onMyWay: true,
      appointmentReminder: true,
      serviceDue: true,
      invoiceOverdue: true,
    });
    expect(s.templates.onMyWay).toBe(DEFAULT_SMS_TEMPLATES.onMyWay);
    expect(s.templates.general).toBe("Hello {{clientName}}");
    expect(resolveSmsSettings(null).enabled.invoiceOverdue).toBe(false);
  });

  it("greets residential clients by first name and businesses by their contact", () => {
    expect(greetingName({ type: "RESIDENTIAL", name: "Sarah Nguyen" })).toBe("Sarah");
    expect(
      greetingName({
        type: "COMMERCIAL",
        name: "Melbourne Dental",
        contacts: [{ name: "Leanne Cooper" }],
      }),
    ).toBe("Leanne");
    expect(greetingName({ type: "COMMERCIAL", name: "Melbourne Dental", contacts: [] })).toBe(
      "there",
    );
  });
});
