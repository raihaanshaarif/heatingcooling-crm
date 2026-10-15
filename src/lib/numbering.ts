import type { Tx } from "@/lib/db";

export type DocumentType = "QUOTE" | "JOB" | "INVOICE" | "CREDIT_NOTE";

export const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  QUOTE: "Q",
  JOB: "J",
  INVOICE: "INV",
  CREDIT_NOTE: "CN",
};

/** Q-0001, INV-0042, J-12345 (pads to at least 4 digits, never truncates). */
export function formatDocumentNumber(prefix: string, value: number, pad = 4): string {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`Invalid document counter value: ${value}`);
  const cleanPrefix = prefix.trim().replace(/-+$/, "");
  const digits = String(value).padStart(pad, "0");
  return cleanPrefix ? `${cleanPrefix}-${digits}` : digits;
}

/**
 * Atomically increment the counter for a document type and return the next number.
 * Must be called inside a transaction: the UPSERT ... RETURNING takes a row lock so
 * two concurrent requests can never get the same number.
 */
export async function nextDocumentNumber(tx: Tx, type: DocumentType): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("id", "key", "value", "createdAt", "updatedAt")
    VALUES (${`counter_${type.toLowerCase()}`}, ${type}, 1, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (!value) throw new Error(`Could not allocate a ${type} number`);
  const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
  const prefix =
    type === "QUOTE"
      ? settings?.quotePrefix
      : type === "JOB"
        ? settings?.jobPrefix
        : type === "INVOICE"
          ? settings?.invoicePrefix
          : settings?.creditNotePrefix;
  return formatDocumentNumber(prefix ?? DEFAULT_PREFIXES[type], value);
}
