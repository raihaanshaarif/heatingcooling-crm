import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { listInvoices } from "@/server/invoices/queries";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { InvoicesTable } from "@/components/invoices/invoices-table";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const user = await requirePermission("view", "invoices");
  const invoices = await listInvoices();
  const open = invoices.filter((i) => ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(i.status));
  const overdue = invoices.filter((i) => i.status === "OVERDUE");
  const drafts = invoices.filter((i) => i.status === "DRAFT");
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices, payments and credit notes."
        actions={
          can(user, "create", "invoices") && (
            <Button asChild>
              <Link href="/invoices/new">
                <Plus /> New invoice
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Outstanding"
          value={formatCents(open.reduce((s, i) => s + i.balanceCents, 0))}
          hint={`${open.length} open invoices`}
        />
        <StatCard
          label="Overdue"
          tone={overdue.length ? "danger" : "default"}
          value={formatCents(overdue.reduce((s, i) => s + i.balanceCents, 0))}
          hint={`${overdue.length} invoices`}
        />
        <StatCard
          label="Drafts"
          value={drafts.length}
          hint={formatCents(drafts.reduce((s, i) => s + i.totalCents, 0))}
        />
      </div>
      <InvoicesTable data={invoices} />
    </>
  );
}
