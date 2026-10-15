import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listQuotes } from "@/server/quotes/queries";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { QuotesTable } from "@/components/quotes/quotes-table";

export const metadata: Metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const user = await requirePermission("view", "quotes");
  const quotes = await listQuotes();
  return (
    <>
      <PageHeader
        title="Quotes"
        description="Estimates with Good / Better / Best options, sent for online acceptance."
        actions={
          can(user, "create", "quotes") && (
            <Button asChild>
              <Link href="/quotes/new">
                <Plus /> New quote
              </Link>
            </Button>
          )
        }
      />
      <QuotesTable data={quotes} />
    </>
  );
}
