import Link from "next/link";
import type { XeroJobKind, XeroJobStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/dates";
import { MAX_ATTEMPTS } from "@/lib/xero/queue";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { XeroLogRow } from "@/server/xero/queries";
import { RetryXeroJobButton } from "./xero-sync-status";

export const XERO_JOB_KIND_LABELS: Record<XeroJobKind, string> = {
  CONTACT: "Contact",
  INVOICE: "Invoice",
  VOID_INVOICE: "Void invoice",
  CREDIT_NOTE: "Credit note",
  PAYMENT: "Payment",
  DELETE_PAYMENT: "Delete payment",
};

export const XERO_JOB_STATUS_LABELS: Record<XeroJobStatus, string> = {
  PENDING: "Waiting",
  PROCESSING: "Sending",
  DONE: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const VARIANT: Record<XeroJobStatus, BadgeVariant> = {
  PENDING: "warning",
  PROCESSING: "muted",
  DONE: "success",
  FAILED: "destructive",
  CANCELLED: "muted",
};

export function XeroJobStatusBadge({ status }: { status: XeroJobStatus }) {
  return <Badge variant={VARIANT[status]}>{XERO_JOB_STATUS_LABELS[status]}</Badge>;
}

export function XeroLogTable({ rows, canRetry }: { rows: XeroLogRow[]; canRetry: boolean }) {
  if (rows.length === 0)
    return <p className="text-muted-foreground text-sm">Nothing has been sent to Xero yet.</p>;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Updated</TableHead>
            <TableHead>What</TableHead>
            <TableHead className="min-w-72">Result</TableHead>
            <TableHead className="pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="align-top" data-testid="xero-log-row">
              <TableCell className="pl-4 whitespace-nowrap">
                {formatDateTime(r.updatedAt)}
                <span className="text-muted-foreground block text-xs">
                  queued {formatDateTime(r.createdAt)}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-medium">{XERO_JOB_KIND_LABELS[r.kind]}</span>
                <span className="block text-xs">
                  {r.invoiceId ? (
                    <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">
                      {r.label}
                    </Link>
                  ) : r.kind === "CONTACT" ? (
                    <Link href={`/clients/${r.entityId}`} className="hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </span>
              </TableCell>
              <TableCell className="text-sm">
                {r.lastError ?? (r.status === "DONE" ? "Sent to Xero" : "–")}
                <span className="text-muted-foreground block text-xs">
                  {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
                  {r.status === "PENDING" && r.attempts > 0
                    ? ` · next try ${formatDateTime(r.nextAttemptAt)} (max ${MAX_ATTEMPTS})`
                    : ""}
                </span>
              </TableCell>
              <TableCell className="space-y-2 pr-4">
                <XeroJobStatusBadge status={r.status} />
                {canRetry &&
                  (r.status === "FAILED" || (r.status === "PENDING" && r.attempts > 0)) && (
                    <div>
                      <RetryXeroJobButton id={r.id} />
                    </div>
                  )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
