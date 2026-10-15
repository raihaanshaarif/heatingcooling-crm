import { xeroSettingsSchema, type XeroSettings } from "@/lib/validations/settings";

export const DEFAULT_XERO_SETTINGS: XeroSettings = {
  salesAccountCode: "200",
  taxTypeTaxable: "OUTPUT", // "GST on Income" in Xero AU
  taxTypeFree: "EXEMPTOUTPUT", // "GST Free Income"
  bankAccountId: null,
  bankAccountCode: null,
  bankAccountName: null,
  invoiceStatus: "AUTHORISED",
  autoSync: true,
};

/** Stored JSON (may be null or from an older version) merged over the defaults. */
export function resolveXeroSettings(stored: unknown): XeroSettings {
  const merged = {
    ...DEFAULT_XERO_SETTINGS,
    ...(stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {}),
  };
  const parsed = xeroSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_XERO_SETTINGS;
}
