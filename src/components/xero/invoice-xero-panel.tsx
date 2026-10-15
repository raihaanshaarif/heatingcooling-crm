import type { InvoiceStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/dates";
import { xeroLinks } from "@/lib/xero/payloads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { getInvoiceXeroState } from "@/server/xero/queries";
import { XERO_JOB_KIND_LABELS } from "./xero-log-table";
import { RetryXeroInvoiceButton } from "./xero-sync-status";

type State = Awaited<ReturnType<typeof getInvoiceXeroState>>;

/** "Xero: synced / waiting / failed — reason, Retry" on the invoice page. */
export function InvoiceXeroPanel({
  state,
  invoiceStatus,
  canRetry,
}: {
  state: State;
  invoiceStatus: InvoiceStatus;
  canRetry: boolean;
}) {
  const { connected, invoice, jobs } = state;
  if (!invoice || (!connected && !invoice.xeroInvoiceId && !invoice.xeroSyncStatus)) return null;
  const failed = jobs.filter(
    (j) => j.status === "FAILED" || (j.status === "PENDING" && j.lastError),
  );
  const waiting = jobs.filter((j) => !failed.includes(j));
  const neverPushed = !invoice.xeroInvoiceId && jobs.length === 0 && invoiceStatus !== "DRAFT";
  return (
    <Card className="h-fit" data-testid="invoice-xero-panel">
      <CardHeader>
        <CardTitle>Xero</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {failed.map((j) => (
          <div key={j.id} className="text-destructive" data-testid="xero-failure">
            <p className="font-medium">
              Xero: failed{j.status === "PENDING" ? " (will retry automatically)" : ""}
            </p>
            <p className="text-xs">
              {XERO_JOB_KIND_LABELS[j.kind]} · {j.label}: {j.lastError}
            </p>
          </div>
        ))}
        {waiting.map((j) => (
          <p key={j.id} className="text-muted-foreground">
            Waiting to sync: {XERO_JOB_KIND_LABELS[j.kind].toLowerCase()} · {j.label}
          </p>
        ))}
        {jobs.length === 0 && invoice.xeroSyncStatus === "SYNCED" && (
          <p>
            Synced{invoice.xeroSyncedAt ? ` ${formatDateTime(invoice.xeroSyncedAt)}` : ""}
            {invoice.xeroInvoiceId && (
              <>
                {" · "}
                <a
                  href={xeroLinks.invoice(invoice.xeroInvoiceId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open in Xero
                </a>
              </>
            )}
          </p>
        )}
        {neverPushed && invoice.xeroSyncStatus !== "SYNCED" && (
          <p className="text-muted-foreground">
            {invoiceStatus === "VOID" ? "Void, never sent to Xero." : "Not in Xero yet."}
          </p>
        )}
        {connected && canRetry && (failed.length > 0 || waiting.length > 0) && (
          <RetryXeroInvoiceButton
            id={state.invoiceId}
            label={failed.length ? "Retry" : "Sync now"}
          />
        )}
        {connected &&
          canRetry &&
          neverPushed &&
          invoiceStatus !== "VOID" &&
          invoice.xeroSyncStatus !== "SYNCED" && (
            <RetryXeroInvoiceButton id={state.invoiceId} label="Push to Xero" />
          )}
        {!connected && (
          <p className="text-muted-foreground text-xs">Xero is not connected at the moment.</p>
        )}
      </CardContent>
    </Card>
  );
}
