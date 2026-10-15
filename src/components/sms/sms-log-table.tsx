import Link from "next/link";
import type { SmsStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/dates";
import { formatAuMobile } from "@/lib/sms/phone";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SmsLogRow } from "@/server/sms/queries";

export const SMS_STATUS_LABELS: Record<SmsStatus, string> = {
  SENT: "Sent",
  LOGGED: "Logged only",
  SKIPPED: "Not sent",
  FAILED: "Failed",
};

const STATUS_VARIANT: Record<SmsStatus, BadgeVariant> = {
  SENT: "success",
  LOGGED: "muted",
  SKIPPED: "warning",
  FAILED: "destructive",
};

export function SmsStatusBadge({ status }: { status: SmsStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{SMS_STATUS_LABELS[status]}</Badge>;
}

export function SmsLogTable({
  rows,
  kindLabels,
}: {
  rows: SmsLogRow[];
  kindLabels: Record<string, string>;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No texts yet.</p>;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">When</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="min-w-72">Message</TableHead>
            <TableHead className="pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="align-top">
              <TableCell className="pl-4 whitespace-nowrap">
                {formatDateTime(r.createdAt)}
                {r.sentBy && (
                  <span className="text-muted-foreground block text-xs">{r.sentBy.name}</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {r.client ? (
                  <Link href={`/clients/${r.client.id}`} className="font-medium hover:underline">
                    {r.client.name}
                  </Link>
                ) : (
                  "–"
                )}
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {r.to ? formatAuMobile(r.to) : (r.rawPhone ?? "no number")}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {kindLabels[r.kind] ?? r.kind}
                {(r.job || r.invoice) && (
                  <span className="block text-xs">
                    {r.job && (
                      <Link href={`/jobs/${r.job.id}`} className="hover:underline">
                        {r.job.number}
                      </Link>
                    )}
                    {r.invoice && (
                      <Link href={`/invoices/${r.invoice.id}`} className="hover:underline">
                        {r.invoice.number}
                      </Link>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm whitespace-pre-line">
                {r.body}
                <span className="text-muted-foreground block text-xs">
                  {r.segments} SMS · {r.provider}
                  {r.providerMessageId ? ` · ${r.providerMessageId}` : ""}
                </span>
              </TableCell>
              <TableCell className="pr-4">
                <SmsStatusBadge status={r.status} />
                {r.error && (
                  <span className="text-muted-foreground mt-1 block max-w-56 text-xs">
                    {r.error}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
