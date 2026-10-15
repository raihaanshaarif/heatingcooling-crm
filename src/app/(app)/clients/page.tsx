import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listClients } from "@/server/clients/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { ClientsTable } from "@/components/clients/clients-table";
import { ClientForm } from "@/components/clients/client-form";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const user = await requirePermission("view", "clients");
  const clients = await listClients();
  return (
    <>
      <PageHeader
        title="Clients"
        description="Residential, commercial, property managers and builders."
        actions={
          can(user, "create", "clients") && (
            <NewRecordDialog label="New client" title="New client" wide>
              <ClientForm />
            </NewRecordDialog>
          )
        }
      />
      <ClientsTable data={clients} />
    </>
  );
}
