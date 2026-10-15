import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { appUrl, formatAddress } from "@/lib/utils";
import { getQuote } from "@/server/quotes/queries";
import { getTimeline } from "@/server/activity/queries";
import { getSettings } from "@/server/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { QuoteStatusBadge } from "@/components/shared/status-badge";
import { NoteForm, Timeline } from "@/components/shared/timeline";
import { QuoteActions } from "@/components/quotes/quote-actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "quotes");
  const { id } = await params;
  const [quote, settings] = await Promise.all([getQuote(id), getSettings()]);
  if (!quote) notFound();
  const timeline = await getTimeline([{ entityType: "QUOTE", ids: [quote.id] }]);
  const multi = quote.options.length > 1;
  return (
    <>
      <PageHeader
        back={{ href: "/quotes", label: "Quotes" }}
        title={quote.number}
        badge={<QuoteStatusBadge status={quote.status} />}
        description={quote.title}
        actions={
          <QuoteActions
            quote={{
              id: quote.id,
              number: quote.number,
              status: quote.status,
              hasEmail: !!quote.client.email,
              options: quote.options.map((o) => ({
                id: o.id,
                name: o.name,
                totalCents: o.totalCents,
              })),
              jobId: quote.jobs[0]?.id ?? null,
            }}
            publicUrl={appUrl(`/q/${quote.publicToken}`)}
            canEdit={can(user, "update", "quotes")}
            canDelete={can(user, "delete", "quotes")}
            canCreateJob={can(user, "create", "jobs")}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {quote.intro && (
            <Card>
              <CardContent className="text-sm whitespace-pre-line">{quote.intro}</CardContent>
            </Card>
          )}
          {quote.options.map((o) => {
            const selected = quote.selectedOptionId === o.id;
            return (
              <Card
                key={o.id}
                className={cn(selected && "border-emerald-500 ring-1 ring-emerald-500")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {multi ? o.name : "Line items"}
                    {selected && (
                      <span className="inline-flex items-center gap-1 text-sm font-normal text-emerald-600">
                        <CheckCircle2 className="size-4" /> Chosen by client
                      </span>
                    )}
                  </CardTitle>
                  {o.description && (
                    <p className="text-muted-foreground text-sm">{o.description}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit ex GST</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {o.lineItems.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="whitespace-normal">
                            {l.description}
                            {!l.taxable && settings.gstRegistered && (
                              <span className="text-muted-foreground text-xs"> (GST free)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(l.unitPriceCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(l.totalCents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3} className="text-right">
                          Subtotal
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(o.subtotalCents)}
                        </TableCell>
                      </TableRow>
                      {settings.gstRegistered && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-right">
                            GST
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(o.gstCents)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow>
                        <TableCell colSpan={3} className="text-right font-semibold">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCents(o.totalCents)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {can(user, "update", "quotes") && <NoteForm entityType="QUOTE" entityId={quote.id} />}
              <Timeline items={timeline} />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                {
                  label: "Client",
                  value: (
                    <Link className="hover:underline" href={`/clients/${quote.clientId}`}>
                      {quote.client.name}
                    </Link>
                  ),
                },
                { label: "Site", value: quote.property ? formatAddress(quote.property) : null },
                {
                  label: "Lead",
                  value: quote.lead && (
                    <Link className="hover:underline" href={`/leads/${quote.lead.id}`}>
                      L-{quote.lead.leadNumber}
                    </Link>
                  ),
                },
                {
                  label: multi ? "From" : "Total",
                  value: formatCents(
                    multi && !quote.selectedOptionId
                      ? Math.min(...quote.options.map((o) => o.totalCents))
                      : quote.totalCents,
                  ),
                },
                { label: "Created", value: formatDate(quote.createdAt) },
                {
                  label: "Valid until",
                  value: quote.validUntil ? formatDate(quote.validUntil) : null,
                },
                { label: "Sent", value: quote.sentAt ? formatDateTime(quote.sentAt) : null },
                { label: "Viewed", value: quote.viewedAt ? formatDateTime(quote.viewedAt) : null },
                {
                  label: "Accepted",
                  value: quote.acceptedAt ? formatDateTime(quote.acceptedAt) : null,
                },
                {
                  label: "Declined",
                  value: quote.declinedAt ? formatDateTime(quote.declinedAt) : null,
                },
                {
                  label: "Job",
                  value: quote.jobs.map((j) => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="hover:underline">
                      {j.number}
                    </Link>
                  )),
                  hidden: quote.jobs.length === 0,
                },
              ]}
            />
            {quote.terms && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium">Terms</summary>
                <p className="text-muted-foreground mt-2 text-xs whitespace-pre-line">
                  {quote.terms}
                </p>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
