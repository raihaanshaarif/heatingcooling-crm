import { describe, expect, it } from "vitest";
import {
  ageBucket,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateFromTerms,
  dueOverdueReminderStages,
  invoiceBalance,
} from "./invoice-status";
import { fromMelbourneInput, toDateInput } from "./dates";

const now = fromMelbourneInput("2025-06-20T10:00");
const due = (d: string) => fromMelbourneInput(d);

describe("deriveInvoiceStatus", () => {
  const base = {
    status: "SENT" as const,
    totalCents: 11000,
    amountPaidCents: 0,
    dueDate: due("2025-06-30"),
  };

  it("keeps void invoices void", () => {
    expect(deriveInvoiceStatus({ ...base, status: "VOID", amountPaidCents: 11000 }, now)).toBe(
      "VOID",
    );
  });

  it("keeps drafts as drafts until sent or paid", () => {
    expect(deriveInvoiceStatus({ ...base, status: "DRAFT", dueDate: due("2025-01-01") }, now)).toBe(
      "DRAFT",
    );
    expect(deriveInvoiceStatus({ ...base, status: "DRAFT", amountPaidCents: 11000 }, now)).toBe(
      "PAID",
    );
  });

  it("marks fully paid invoices as paid", () => {
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 11000 }, now)).toBe("PAID");
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 6000, creditedCents: 5000 }, now)).toBe(
      "PAID",
    );
  });

  it("marks part payments", () => {
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 5000 }, now)).toBe("PARTIALLY_PAID");
  });

  it("marks invoices overdue the day after the due date in Melbourne", () => {
    expect(deriveInvoiceStatus({ ...base, dueDate: due("2025-06-20") }, now)).toBe("SENT");
    expect(deriveInvoiceStatus({ ...base, dueDate: due("2025-06-19") }, now)).toBe("OVERDUE");
    expect(
      deriveInvoiceStatus({ ...base, amountPaidCents: 100, dueDate: due("2025-06-01") }, now),
    ).toBe("OVERDUE");
  });

  it("falls back to sent when nothing else applies", () => {
    expect(deriveInvoiceStatus({ ...base, status: "OVERDUE" }, now)).toBe("SENT");
  });
});

describe("invoice helpers", () => {
  it("computes balance after payments and credits", () => {
    expect(invoiceBalance({ totalCents: 10000, amountPaidCents: 2500, creditedCents: 1000 })).toBe(
      6500,
    );
  });

  it("computes due dates from payment terms in Melbourne time", () => {
    const issue = fromMelbourneInput("2025-03-28T09:00");
    expect(toDateInput(dueDateFromTerms(issue, "ON_COMPLETION"))).toBe("2025-03-28");
    expect(toDateInput(dueDateFromTerms(issue, "DAYS_7"))).toBe("2025-04-04"); // across DST end (6 Apr)
    expect(toDateInput(dueDateFromTerms(issue, "DAYS_14"))).toBe("2025-04-11");
    expect(toDateInput(dueDateFromTerms(issue, "DAYS_30"))).toBe("2025-04-27");
  });

  it("counts overdue days", () => {
    expect(daysOverdue(due("2025-06-20"), now)).toBe(0);
    expect(daysOverdue(due("2025-06-13"), now)).toBe(7);
    expect(daysOverdue(due("2025-07-01"), now)).toBe(0);
  });

  it("sends each overdue reminder once", () => {
    expect(dueOverdueReminderStages(0, [])).toEqual([]);
    expect(dueOverdueReminderStages(1, [])).toEqual([1]);
    expect(dueOverdueReminderStages(8, [1])).toEqual([7]);
    expect(dueOverdueReminderStages(20, [1, 7, 14])).toEqual([]);
    expect(dueOverdueReminderStages(20, [])).toEqual([1, 7, 14]);
  });

  it("buckets aged receivables", () => {
    expect(ageBucket(due("2025-06-25"), now)).toBe("current");
    expect(ageBucket(due("2025-06-01"), now)).toBe("1-30");
    expect(ageBucket(due("2025-05-01"), now)).toBe("31-60");
    expect(ageBucket(due("2025-04-01"), now)).toBe("61-90");
    expect(ageBucket(due("2025-01-01"), now)).toBe("90+");
  });
});
