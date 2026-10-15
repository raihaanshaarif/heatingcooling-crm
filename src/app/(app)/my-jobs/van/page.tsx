import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/inventory";
import { STOCK_MOVEMENT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getVanStock } from "@/server/inventory/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "My van stock" };

/** Read-only: what's in the signed-in technician's van, and what moved recently. */
export default async function MyVanPage() {
  const user = await requirePermission("view", "myJobs");
  const van = await getVanStock(user.id);
  const back = { href: "/my-jobs", label: "My jobs" };
  if (!van)
    return (
      <>
        <PageHeader title="My van stock" back={back} />
        <EmptyState
          icon={Truck}
          title="No van set up for you"
          description={
            can(user, "view", "inventory")
              ? "Vans are created for technicians. See Inventory for all stock."
              : "Ask the office to set up your van."
          }
          action={
            can(user, "view", "inventory") ? (
              <Link href="/inventory" className="text-sm underline">
                Open Inventory
              </Link>
            ) : undefined
          }
        />
      </>
    );
  const negative = van.items.filter((i) => i.quantity < 0);
  return (
    <>
      <PageHeader
        title={van.name}
        back={back}
        description="Parts you add to a job are taken from here automatically. The office restocks and corrects counts."
      />
      <div className="mx-auto max-w-2xl space-y-4">
        {negative.length > 0 && (
          <Card className="border-destructive/40">
            <CardContent className="text-sm">
              <p className="text-destructive font-medium">
                {negative.length} item{negative.length === 1 ? " shows" : "s show"} less than zero
              </p>
              <p className="text-muted-foreground">
                You&apos;ve used more than the van was loaded with. Let the office know so they can
                restock or correct the count.
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>In the van</CardTitle>
          </CardHeader>
          <CardContent>
            {van.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">Your van has no stock recorded.</p>
            ) : (
              <ul className="divide-y">
                {van.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.name}</p>
                      {i.sku && <p className="text-muted-foreground text-xs">{i.sku}</p>}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-lg font-semibold tabular-nums",
                        i.quantity < 0 && "text-destructive",
                      )}
                    >
                      {formatQty(i.quantity, i.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent movements</CardTitle>
          </CardHeader>
          <CardContent>
            {van.recent.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {van.recent.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate">{m.itemName}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(m.createdAt)} · {STOCK_MOVEMENT_LABELS[m.type]}
                        {m.job ? (
                          <>
                            {" "}
                            ·{" "}
                            <Link href={`/my-jobs/${m.job.id}`} className="underline">
                              {m.job.number}
                            </Link>
                          </>
                        ) : (
                          m.other && ` · ${m.other}`
                        )}
                      </p>
                    </div>
                    <Badge variant={m.quantity < 0 ? "muted" : "success"} className="tabular-nums">
                      {m.quantity > 0 ? "+" : ""}
                      {formatQty(m.quantity, m.unit)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
