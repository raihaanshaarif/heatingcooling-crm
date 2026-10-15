import type { InvoiceStatus, JobStatus, LeadStatus, Priority, QuoteStatus } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  INVOICE_STATUS_LABELS,
  JOB_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  PRIORITY_LABELS,
  QUOTE_STATUS_LABELS,
} from "@/lib/labels";

const LEAD: Record<LeadStatus, BadgeVariant> = {
  NEW: "info",
  CONTACTED: "secondary",
  SITE_VISIT_BOOKED: "violet",
  QUOTED: "warning",
  WON: "success",
  LOST: "muted",
};
const QUOTE: Record<QuoteStatus, BadgeVariant> = {
  DRAFT: "muted",
  SENT: "info",
  VIEWED: "violet",
  ACCEPTED: "success",
  DECLINED: "destructive",
  EXPIRED: "warning",
};
const JOB: Record<JobStatus, BadgeVariant> = {
  UNSCHEDULED: "muted",
  SCHEDULED: "info",
  EN_ROUTE: "violet",
  IN_PROGRESS: "warning",
  ON_HOLD: "destructive",
  COMPLETED: "success",
  INVOICED: "secondary",
  CANCELLED: "muted",
};
const INVOICE: Record<InvoiceStatus, BadgeVariant> = {
  DRAFT: "muted",
  SENT: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "destructive",
  VOID: "muted",
};
const PRIORITY: Record<Priority, BadgeVariant> = {
  LOW: "muted",
  NORMAL: "secondary",
  HIGH: "warning",
  EMERGENCY: "destructive",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge variant={LEAD[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}
export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge variant={QUOTE[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={JOB[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={INVOICE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "NORMAL") return null;
  return <Badge variant={PRIORITY[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

/** Badge for an expiry date: expired / expiring within `warnDays` / valid. */
export function ExpiryBadge({
  date,
  warnDays = 30,
  now = new Date(),
}: {
  date: Date | null;
  warnDays?: number;
  now?: Date;
}) {
  if (!date) return <Badge variant="muted">No expiry</Badge>;
  const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return <Badge variant="destructive">Expired</Badge>;
  if (days <= warnDays) return <Badge variant="warning">Expires in {days}d</Badge>;
  return <Badge variant="success">Valid</Badge>;
}
