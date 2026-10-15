"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { xeroSettingsSchema, xeroTenantSchema } from "@/lib/validations/settings";
import { UserError, idSchema, runAction } from "@/server/action";
import { audit, diff } from "@/server/audit";
import { getSettings } from "@/server/settings";
import {
  CONNECTION_ID,
  disconnectXero,
  getXeroConnection,
  getXeroSettings,
  resetIdsIfOrganisationChanged,
  storedTenants,
} from "./connection";
import { enqueueXeroJob } from "./queue";
import { processXeroQueue, type SyncRunResult } from "./sync";

function revalidateXero(invoiceId?: string | null) {
  revalidatePath("/integrations");
  revalidatePath("/settings");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

function describeRun(r: SyncRunResult): string {
  if (!r.ran) return r.reason ?? "Nothing to sync.";
  if (r.processed === 0) return "Everything is already in Xero.";
  const parts = [`${r.succeeded} synced`];
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.remaining) parts.push(`${r.remaining} still waiting`);
  if (r.rateLimited) parts.push("Xero asked us to slow down, the rest will follow shortly");
  return `Xero: ${parts.join(", ")}.`;
}

async function requireConnected() {
  const conn = await getXeroConnection();
  if (!conn)
    throw new UserError("Xero isn't connected. Connect it on the Integrations page first.");
  if (!conn.tenantId) throw new UserError("Choose which Xero organisation to use first.");
  return conn;
}

export async function saveXeroSettings(input: z.input<typeof xeroSettingsSchema>) {
  return runAction(
    { schema: xeroSettingsSchema, permission: ["update", "settings"] },
    input,
    async (d, user) => {
      const before = await getXeroSettings();
      await db.$transaction(async (tx) => {
        await tx.businessSettings.update({ where: { id: "singleton" }, data: { xeroSettings: d } });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "SETTINGS",
          entityId: "xero",
          changes: diff(before, d),
        });
      });
      revalidateXero();
      return null;
    },
  );
}

/**
 * Pick the organisation. Xero IDs stored on clients, invoices, payments and credit notes
 * belong to one organisation, so switching to a different one forgets them (the records
 * are pushed fresh to the new organisation when they next change or on Retry).
 */
export async function chooseXeroTenant(input: z.input<typeof xeroTenantSchema>) {
  return runAction(
    { schema: xeroTenantSchema, permission: ["update", "settings"] },
    input,
    async ({ tenantId }, user) => {
      const conn = await getXeroConnection();
      if (!conn) throw new UserError("Xero isn't connected.");
      const tenant = storedTenants(conn.tenants).find((t) => t.tenantId === tenantId);
      if (!tenant) throw new UserError("That organisation isn't part of this Xero connection.");
      const settings = await getSettings();
      await db.$transaction(async (tx) => {
        await tx.xeroConnection.update({
          where: { id: CONNECTION_ID },
          data: { tenantId: tenant.tenantId, tenantName: tenant.tenantName },
        });
        await resetIdsIfOrganisationChanged(tx, settings.xeroTenantId, tenant.tenantId);
        await audit(tx, {
          userId: user.id,
          action: "XERO_ORGANISATION",
          entityType: "SETTINGS",
          entityId: "xero",
          changes: { tenantId: tenant.tenantId, tenantName: tenant.tenantName },
        });
      });
      revalidateXero();
      return { tenantName: tenant.tenantName };
    },
  );
}

export async function disconnectXeroAction() {
  return runAction(
    { schema: z.object({}), permission: ["update", "settings"] },
    {},
    async (_d, user) => {
      const conn = await getXeroConnection();
      if (!conn) throw new UserError("Xero isn't connected.");
      const result = await disconnectXero();
      await audit(db, {
        userId: user.id,
        action: "XERO_DISCONNECT",
        entityType: "SETTINGS",
        entityId: "xero",
        changes: { tenantName: conn.tenantName, revoked: result.revoked, error: result.error },
      });
      revalidateXero();
      return {
        message: result.revoked
          ? "Disconnected from Xero"
          : `Disconnected. Tokens deleted${result.error ? `, but Xero couldn't be told (${result.error}); you can also remove CoolOps under Xero → Settings → Connected apps` : ""}.`,
      };
    },
  );
}

export async function syncXeroNow() {
  return runAction({ schema: z.object({}), permission: ["update", "settings"] }, {}, async () => {
    await requireConnected();
    const result = await processXeroQueue({ maxJobs: 50, timeBudgetMs: 40_000, force: true });
    revalidateXero();
    return { message: describeRun(result), result };
  });
}

export async function retryXeroJob(input: { id: string }) {
  return runAction({ schema: idSchema, permission: ["update", "xero"] }, input, async ({ id }) => {
    await requireConnected();
    const job = await db.xeroSyncJob.findUnique({ where: { id } });
    if (!job) throw new UserError("Sync job not found.");
    if (job.status === "DONE" || job.status === "PROCESSING")
      throw new UserError("That job doesn't need a retry.");
    await db.xeroSyncJob.update({
      where: { id },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), completedAt: null },
    });
    const result = await processXeroQueue({ maxJobs: 10, timeBudgetMs: 25_000 });
    revalidateXero(job.invoiceId);
    return { message: describeRun(result) };
  });
}

/** Retry everything waiting or failed on one invoice, or push it if it was never sent to Xero. */
export async function retryXeroInvoice(input: { id: string }) {
  return runAction({ schema: idSchema, permission: ["update", "xero"] }, input, async ({ id }) => {
    await requireConnected();
    const invoice = await db.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!invoice) throw new UserError("Invoice not found.");
    const retried = await db.xeroSyncJob.updateMany({
      where: { invoiceId: id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), completedAt: null },
    });
    if (retried.count === 0) {
      if (invoice.status === "DRAFT")
        throw new UserError("Send the invoice before pushing it to Xero.");
      await enqueueXeroJob(db, {
        kind: invoice.status === "VOID" ? "VOID_INVOICE" : "INVOICE",
        entityId: id,
        invoiceId: id,
        label: invoice.status === "VOID" ? `Void ${invoice.number}` : invoice.number,
      });
    }
    const result = await processXeroQueue({ maxJobs: 10, timeBudgetMs: 25_000 });
    revalidateXero(id);
    return { message: describeRun(result) };
  });
}

export async function retryAllFailedXero() {
  return runAction({ schema: z.object({}), permission: ["update", "settings"] }, {}, async () => {
    await requireConnected();
    const { count } = await db.xeroSyncJob.updateMany({
      where: { OR: [{ status: "FAILED" }, { status: "PENDING", lastError: { not: null } }] },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), completedAt: null },
    });
    if (count === 0) return { message: "No failed jobs." };
    const result = await processXeroQueue({ maxJobs: 50, timeBudgetMs: 40_000 });
    revalidateXero();
    return { message: describeRun(result) };
  });
}
