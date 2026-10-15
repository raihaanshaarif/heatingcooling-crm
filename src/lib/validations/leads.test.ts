import { describe, expect, it } from "vitest";
import { leadSchema, mapServiceCategory, webhookLeadSchema } from "./leads";

describe("webhookLeadSchema", () => {
  it("accepts a typical website form post", () => {
    const r = webhookLeadSchema.safeParse({
      name: "Tom Nguyen",
      email: "TOM@example.com",
      phone: "0412 345 678",
      suburb: "Richmond",
      postcode: "3121",
      service: "Split system installation",
      utm_source: "google",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.email).toBe("tom@example.com");
  });

  it("requires a name and an email or phone", () => {
    expect(webhookLeadSchema.safeParse({ name: "No contact" }).success).toBe(false);
    expect(webhookLeadSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
    expect(webhookLeadSchema.safeParse({ name: "Phone only", phone: "0398765432" }).success).toBe(
      true,
    );
  });

  it("rejects bad postcodes and emails", () => {
    expect(webhookLeadSchema.safeParse({ name: "x", email: "nope" }).success).toBe(false);
    expect(
      webhookLeadSchema.safeParse({ name: "x", phone: "0398765432", postcode: "31" }).success,
    ).toBe(false);
  });
});

describe("mapServiceCategory", () => {
  it("maps free text onto categories", () => {
    expect(mapServiceCategory("Ducted heating service")).toBe("DUCTED");
    expect(mapServiceCategory("Split system install")).toBe("SPLIT_SYSTEM");
    expect(mapServiceCategory("Gas heater not working")).toBe("GAS_HEATING");
    expect(mapServiceCategory("EMERGENCY - no cooling")).toBe("EMERGENCY_REPAIR");
    expect(mapServiceCategory("Evaporative cooler")).toBe("EVAPORATIVE");
    expect(mapServiceCategory("something else")).toBe("OTHER");
    expect(mapServiceCategory(undefined)).toBeNull();
  });
});

describe("leadSchema", () => {
  it("formats phone numbers and converts dollars to cents", () => {
    const r = leadSchema.parse({
      name: "Jo",
      phone: "0412345678",
      source: "PHONE",
      estimatedValue: "1,250.50",
    });
    expect(r.phone).toBe("0412 345 678");
    expect(r.estimatedValue).toBe(125050);
  });

  it("needs a phone or email", () => {
    expect(leadSchema.safeParse({ name: "Jo", source: "PHONE" }).success).toBe(false);
  });
});
