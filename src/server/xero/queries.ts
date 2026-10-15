import "server-only";
import type { XeroJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getXeroApi, getXeroConfig, getXeroConnection, storedTenants } from "./connection";

export type XeroOverview = Awaited<ReturnType<typeof getXeroOverview>>;

/** Everything the Integrations card needs. */
export async function getXeroOverview() {
  const config = getXeroConfig();
  const [conn, gaveUp, retrying, waiting] = await Promise.all([
    getXeroConnection(),
    db.xeroSyncJob.count({ where: { status: "FAILED" } }),
    // Failed at least once and waiting for an automatic retry.
    db.xeroSyncJob.count({ where: { status: "PENDING", lastError: { not: null } } }),
    db.xeroSyncJob.count({
      where: { OR: [{ status: "PENDING", lastError: null }, { status: "PROCESSING" }] },
    }),
  ]);
  const state: "not-set-up" | "not-connected" | "choose-organisation" | "connected" =
    !config.configured
      ? "not-set-up"
      : !conn
        ? "not-connected"
        : !conn.tenantId
          ? "choose-organisation"
          : "connected";
  return {
    state,
    missing: config.configured ? [] : config.missing,
    redirectUri: config.configured ? config.redirectUri : null,
    tenantName: conn?.tenantName ?? null,
    tenants: storedTenants(conn?.tenants),
    lastSyncAt: conn?.lastSyncAt ?? null,
    lastError: conn?.lastError ?? null,
    pending: waiting,
    failed: gaveUp + retrying,
    retrying,
  };
}

/** The Xero panel on an invoice page: the invoice's own state plus jobs that need attention. */
export async function getInvoiceXeroState(invoiceId: string) {
  const conn = await getXeroConnection();
  const [invoice, jobs] = await Promise.all([
    db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        xeroInvoiceId: true,
        xeroSyncStatus: true,
        xeroSyncError: true,
        xeroSyncedAt: true,
      },
    }),
    db.xeroSyncJob.findMany({
      where: { invoiceId, status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { invoiceId, connected: !!conn?.tenantId, invoice, jobs };
}

export async function listXeroLog(filter: { status?: XeroJobStatus; take?: number } = {}) {
  return db.xeroSyncJob.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: { updatedAt: "desc" },
    take: filter.take ?? 200,
  });
}
export type XeroLogRow = Awaited<ReturnType<typeof listXeroLog>>[number];

export interface XeroOptions {
  bankAccounts: { id: string; code: string | null; name: string }[];
  revenueAccounts: { code: string; name: string }[];
  taxRates: { type: string; name: string; rate: number | null }[];
}

/** Chart of accounts and tax rates from Xero for the settings form (null when unavailable). */
export async function getXeroOptions(): Promise<{ options: XeroOptions | null; error?: string }> {
  const api = await getXeroApi();
  if (!api) return { options: null };
  try {
    type Account = {
      AccountID: string;
      Code?: string;
      Name: string;
      Type: string;
      Class?: string;
      Status?: string;
    };
    type TaxRate = {
      TaxType: string;
      Name: string;
      Status?: string;
      CanApplyToRevenue?: boolean;
      EffectiveRate?: number;
    };
    const [accounts, rates] = await Promise.all([
      api.get<{ Accounts?: Account[] }>("/Accounts"),
      api.get<{ TaxRates?: TaxRate[] }>("/TaxRates"),
    ]);
    const active = (accounts.Accounts ?? []).filter((a) => (a.Status ?? "ACTIVE") === "ACTIVE");
    return {
      options: {
        bankAccounts: active
          .filter((a) => a.Type === "BANK")
          .map((a) => ({ id: a.AccountID, code: a.Code ?? null, name: a.Name })),
        revenueAccounts: active
          .filter((a) => a.Class === "REVENUE" && a.Code)
          .map((a) => ({ code: a.Code!, name: a.Name })),
        taxRates: (rates.TaxRates ?? [])
          .filter((t) => (t.Status ?? "ACTIVE") === "ACTIVE" && t.CanApplyToRevenue !== false)
          .map((t) => ({ type: t.TaxType, name: t.Name, rate: t.EffectiveRate ?? null })),
      },
    };
  } catch (error) {
    return { options: null, error: error instanceof Error ? error.message : String(error) };
  }
}
