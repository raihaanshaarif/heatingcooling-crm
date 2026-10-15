import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listSuppliers } from "@/server/inventory/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { SupplierForm } from "@/components/inventory/supplier-form";
import { SuppliersTable } from "@/components/inventory/suppliers-table";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const user = await requirePermission("view", "suppliers");
  const suppliers = await listSuppliers();
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Wholesalers you buy parts and refrigerant from. Pick one when you receive stock."
        actions={
          can(user, "create", "suppliers") && (
            <NewRecordDialog label="New supplier" title="New supplier">
              <SupplierForm />
            </NewRecordDialog>
          )
        }
      />
      <SuppliersTable
        data={suppliers}
        canEdit={can(user, "update", "suppliers")}
        canDelete={can(user, "delete", "suppliers")}
      />
    </>
  );
}
