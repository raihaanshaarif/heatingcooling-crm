import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { listEquipment } from "@/server/equipment/queries";
import { PageHeader } from "@/components/shared/page-header";
import { EquipmentTable } from "@/components/clients/equipment-table";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentPage() {
  await requirePermission("view", "clients");
  const equipment = await listEquipment();
  return (
    <>
      <PageHeader
        title="Equipment"
        description="Every unit installed or serviced. Add new units from a property page."
      />
      <EquipmentTable data={equipment} />
    </>
  );
}
