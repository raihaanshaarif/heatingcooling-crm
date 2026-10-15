import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listPriceBook } from "@/server/price-book/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { PriceBookTable } from "@/components/price-book/price-book-table";
import { PriceBookForm } from "@/components/price-book/price-book-form";

export const metadata: Metadata = { title: "Price book" };

export default async function PriceBookPage() {
  const user = await requirePermission("view", "priceBook");
  const canSeeCosts = can(user, "view", "priceBookCosts");
  const items = await listPriceBook({ includeCosts: canSeeCosts });
  const canEdit = can(user, "update", "priceBook");
  return (
    <>
      <PageHeader
        title="Price book"
        description="Services, parts and equipment. Prices are ex GST."
        actions={
          can(user, "create", "priceBook") && (
            <NewRecordDialog label="New item" title="New price book item">
              <PriceBookForm />
            </NewRecordDialog>
          )
        }
      />
      <PriceBookTable data={items} canSeeCosts={canSeeCosts} canEdit={canEdit} />
    </>
  );
}
