import { describe, expect, it, vi } from "vitest";
import { formatDocumentNumber, nextDocumentNumber } from "./numbering";
import type { Tx } from "./db";

describe("formatDocumentNumber", () => {
  it("pads to four digits with the prefix", () => {
    expect(formatDocumentNumber("Q", 1)).toBe("Q-0001");
    expect(formatDocumentNumber("INV", 42)).toBe("INV-0042");
    expect(formatDocumentNumber("CN", 9999)).toBe("CN-9999");
  });

  it("never truncates large numbers", () => {
    expect(formatDocumentNumber("J", 12345)).toBe("J-12345");
  });

  it("tolerates a trailing dash in the configured prefix", () => {
    expect(formatDocumentNumber("INV-", 7)).toBe("INV-0007");
  });

  it("rejects invalid counter values", () => {
    expect(() => formatDocumentNumber("Q", 0)).toThrow();
    expect(() => formatDocumentNumber("Q", 1.5)).toThrow();
  });
});

describe("nextDocumentNumber", () => {
  function fakeTx(counterValue: number, prefixes: Record<string, string> | null) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ value: counterValue }]),
      businessSettings: { findUnique: vi.fn().mockResolvedValue(prefixes) },
    } as unknown as Tx;
  }

  it("uses the prefix from settings", async () => {
    const tx = fakeTx(5, {
      quotePrefix: "QT",
      jobPrefix: "J",
      invoicePrefix: "INV",
      creditNotePrefix: "CN",
    });
    await expect(nextDocumentNumber(tx, "QUOTE")).resolves.toBe("QT-0005");
  });

  it("falls back to default prefixes when settings are missing", async () => {
    await expect(nextDocumentNumber(fakeTx(12, null), "INVOICE")).resolves.toBe("INV-0012");
    await expect(nextDocumentNumber(fakeTx(3, null), "CREDIT_NOTE")).resolves.toBe("CN-0003");
    await expect(nextDocumentNumber(fakeTx(1, null), "JOB")).resolves.toBe("J-0001");
  });

  it("increments atomically in a single upsert statement", async () => {
    const tx = fakeTx(1, null);
    await nextDocumentNumber(tx, "JOB");
    const call = (tx.$queryRaw as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TemplateStringsArray;
    expect(call.join("?")).toContain("ON CONFLICT");
  });
});
