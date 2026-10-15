import Link from "next/link";
import type {
  InvoiceStatus,
  JobStatus,
  PaymentMethod,
  Priority,
  QuoteStatus,
} from "@prisma/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  InvoiceStatusBadge,
  JobStatusBadge,
  PriorityBadge,
  QuoteStatusBadge,
} from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatDateTime } from "@/lib/dates";
import { JOB_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";

/** Compact, server-rendered tables used on client / property / equipment pages. */

export function QuotesMiniTable({
  quotes,
}: {
  quotes: {
    id: string;
    number: string;
    title: string;
    status: QuoteStatus;
    totalCents: number;
    createdAt: Date;
  }[];
}) {
  if (quotes.length === 0) return <EmptyState title="No quotes yet" />;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Quote</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="pr-4 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map((q) => (
            <TableRow key={q.id}>
              <TableCell className="pl-4 font-medium">
                <Link href={`/quotes/${q.id}`} className="hover:underline">
                  {q.number}
                </Link>
              </TableCell>
              <TableCell className="max-w-64 truncate">{q.title}</TableCell>
              <TableCell>
                <QuoteStatusBadge status={q.status} />
              </TableCell>
              <TableCell>{formatDate(q.createdAt)}</TableCell>
              <TableCell className="pr-4 text-right tabular-nums">
                {formatCents(q.totalCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function JobsMiniTable({
  jobs,
  hrefBase = "/jobs",
}: {
  jobs: {
    id: string;
    number: string;
    title: string;
    type: keyof typeof JOB_TYPE_LABELS;
    status: JobStatus;
    priority: Priority;
    scheduledStart: Date | null;
    assignments?: { user: { name: string } }[];
  }[];
  hrefBase?: string;
}) {
  if (jobs.length === 0) return <EmptyState title="No jobs yet" />;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Job</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead className="pr-4">Technicians</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j) => (
            <TableRow key={j.id}>
              <TableCell className="pl-4 font-medium">
                <Link href={`${hrefBase}/${j.id}`} className="hover:underline">
                  {j.number}
                </Link>
              </TableCell>
              <TableCell className="max-w-64 truncate">{j.title}</TableCell>
              <TableCell>{JOB_TYPE_LABELS[j.type]}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <JobStatusBadge status={j.status} />
                  <PriorityBadge priority={j.priority} />
                </div>
              </TableCell>
              <TableCell>
                {j.scheduledStart ? formatDateTime(j.scheduledStart) : "Unscheduled"}
              </TableCell>
              <TableCell className="pr-4">
                {j.assignments?.map((a) => a.user.name).join(", ") || "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function InvoicesMiniTable({
  invoices,
}: {
  invoices: {
    id: string;
    number: string;
    status: InvoiceStatus;
    issueDate: Date;
    dueDate: Date;
    totalCents: number;
    balanceCents: number;
  }[];
}) {
  if (invoices.length === 0) return <EmptyState title="No invoices yet" />;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Invoice</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="pr-4 text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="pl-4 font-medium">
                <Link href={`/invoices/${i.id}`} className="hover:underline">
                  {i.number}
                </Link>
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge status={i.status} />
              </TableCell>
              <TableCell>{formatDate(i.issueDate)}</TableCell>
              <TableCell>{formatDate(i.dueDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(i.totalCents)}</TableCell>
              <TableCell className="pr-4 text-right tabular-nums">
                {formatCents(i.balanceCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PaymentsMiniTable({
  payments,
}: {
  payments: {
    id: string;
    amountCents: number;
    method: PaymentMethod;
    reference: string | null;
    paidAt: Date;
    invoiceId: string;
    invoice: { number: string };
  }[];
}) {
  if (payments.length === 0) return <EmptyState title="No payments yet" />;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="pr-4 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="pl-4">{formatDate(p.paidAt)}</TableCell>
              <TableCell>
                <Link href={`/invoices/${p.invoiceId}`} className="hover:underline">
                  {p.invoice.number}
                </Link>
              </TableCell>
              <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
              <TableCell>{p.reference ?? "–"}</TableCell>
              <TableCell
                className={`pr-4 text-right tabular-nums ${p.amountCents < 0 ? "text-destructive" : ""}`}
              >
                {formatCents(p.amountCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
