import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Clock, Gauge, Info, MapPin, Route } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, formatMinutes, toDateInput } from "@/lib/dates";
import { FIXED_REASON_LABELS, formatTimeOfDay } from "@/lib/routes/plan";
import { getTechnicianOptions } from "@/server/jobs/queries";
import { ESTIMATE_NOTE, planRoute } from "@/server/routes/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { RoutePicker } from "@/components/routes/route-picker";
import { RouteMap } from "@/components/routes/route-map";
import { RoutePlanner, type RouteRowView } from "@/components/routes/route-planner";

export const metadata: Metadata = { title: "Plan route" };

const km = (n: number) => `${n.toFixed(1)} km`;

export default async function RoutePlanPage({
  searchParams,
}: {
  searchParams: Promise<{ tech?: string; date?: string }>;
}) {
  const user = await requirePermission("update", "routes");
  const params = await searchParams;
  const technicians = await getTechnicianOptions();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : toDateInput(new Date());
  const techId = technicians.some((t) => t.value === params.tech)
    ? params.tech!
    : (technicians.find((t) => t.hint !== "Owner")?.value ?? technicians[0]?.value);
  const view = techId ? await planRoute(techId, day) : null;
  const plan = view?.plan ?? null;

  const rows: RouteRowView[] = (plan?.rows ?? []).map((r) => ({
    jobId: r.job.id,
    number: r.job.number,
    title: r.job.title,
    clientName: r.job.clientName,
    address: r.job.address,
    fixedLabel: r.fixedReason ? FIXED_REASON_LABELS[r.fixedReason] : null,
    currentPosition: r.currentPosition,
    proposedPosition: r.proposedPosition,
    currentStart: r.currentStart,
    currentEnd: r.currentEnd,
    proposedStart: r.proposedStart,
    proposedEnd: r.proposedEnd,
    changed: r.changed,
    currentTravel: r.currentTravel,
    proposedTravel: r.proposedTravel,
    waitMinutes: r.waitMinutes,
    lateMinutes: r.lateMinutes,
  }));
  const last = view?.lastApplied;

  return (
    <>
      <PageHeader
        back={{ href: "/schedule", label: "Schedule" }}
        title="Plan route"
        description="Put a technician's jobs in the order that means the least driving, and fit the times around it."
      />
      <div className="space-y-4">
        <Card className="py-4">
          <CardContent className="px-4">
            <RoutePicker technicians={technicians} technicianId={techId} day={day} compact />
          </CardContent>
        </Card>

        {view && (
          <div
            data-testid="route-provider"
            className={
              view.provider === "google"
                ? "flex items-start gap-2 rounded-md border border-emerald-500/40 px-3 py-2 text-sm"
                : "flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm"
            }
          >
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              {view.provider === "google" ? (
                <>
                  <strong>Using Google Maps</strong> drive times (with traffic when the day is still
                  ahead).
                </>
              ) : (
                <>
                  <strong>Estimate only.</strong> {ESTIMATE_NOTE}
                </>
              )}{" "}
              {view.technician.name} leaves{" "}
              {view.start
                ? `${view.start.kind === "home" ? "home" : "the depot"} (${view.start.address})`
                : "for the first job"}{" "}
              at {formatTimeOfDay(view.dayStart)}
              {view.startsNow ? " (from now, as the day has started)" : ""}.
            </span>
          </div>
        )}
        {view?.notes.map((n) => (
          <p
            key={n}
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            data-testid="route-note"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> {n}
          </p>
        ))}

        {!view || !plan ? (
          <EmptyState
            icon={Route}
            title={view ? `No jobs to plan for ${view.technician.name}` : "No technicians"}
            description={
              view
                ? `Nothing with a map location is booked on ${formatDate(day, "EEEE d MMMM")}.`
                : "Add a technician under Team first."
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3" data-testid="route-summary">
              <StatCard
                label="Driving now"
                icon={Clock}
                value={formatMinutes(plan.before.minutes)}
                hint={`${km(plan.before.km)} in the booked order`}
              />
              <StatCard
                label="Driving with the plan"
                icon={Route}
                value={formatMinutes(plan.after.minutes)}
                hint={`${km(plan.after.km)} · back by ${formatDate(plan.finish, "h:mm a")}`}
              />
              <StatCard
                label="Saving"
                icon={Gauge}
                tone={plan.saving.minutes > 0 ? "success" : "default"}
                value={plan.saving.minutes > 0 ? formatMinutes(plan.saving.minutes) : "None"}
                hint={
                  plan.alreadyBest
                    ? "The booked order is already the shortest."
                    : `${km(Math.max(0, plan.saving.km))} less driving · ${plan.method === "exact" ? "best order (every order checked)" : "near-best order (fast search)"}`
                }
              />
            </div>
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="size-4" /> {view.technician.name} ·{" "}
                    {formatDate(day, "EEE d MMM")}
                  </CardTitle>
                  <CardDescription>
                    {plan.rows.length} stop{plan.rows.length === 1 ? "" : "s"} in the planned order
                    {view.provider === "estimate" && (
                      <Badge variant="warning" className="ml-2">
                        Estimated
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="max-w-3xl">
                  <RouteMap
                    start={view.start?.location ?? null}
                    startLabel={view.start?.label ?? ""}
                    markers={view.markers}
                    proposedPath={view.proposedPath}
                    currentPath={view.currentPath}
                    staticMapSrc={view.staticMapSrc}
                  />
                </CardContent>
              </Card>
              <div className="min-w-0 space-y-4">
                <RoutePlanner
                  technicianId={view.technician.id}
                  technicianName={view.technician.name}
                  day={day}
                  provider={view.provider}
                  before={plan.before}
                  after={plan.after}
                  rows={rows}
                  returnTravel={plan.returnTravel}
                  mapsUrls={view.mapsUrls}
                  lastApplied={
                    last
                      ? {
                          id: last.id,
                          appliedAt: last.createdAt,
                          appliedBy: last.appliedBy?.name ?? null,
                          undoneAt: last.undoneAt,
                          jobs: Array.isArray(last.applied) ? last.applied.length : 0,
                          savingKm: Math.round((last.beforeKm - last.afterKm) * 10) / 10,
                          savingMinutes: last.beforeMinutes - last.afterMinutes,
                        }
                      : null
                  }
                />
                {view.unlocated.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Not on the map</CardTitle>
                      <CardDescription>These keep their booked time.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {view.unlocated.map((j) => (
                          <li key={j.id}>
                            <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                              {j.number}
                            </Link>{" "}
                            · {j.clientName} · {formatDate(j.start, "h:mm a")}
                            {j.address ? ` · ${j.address}` : " · no site address"}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Jobs that are emergencies, marked <em>Time fixed</em>, shared with another technician, or
          already under way keep their time. Times start at {formatTimeOfDay(view?.dayStart ?? 420)}{" "}
          and round up to 5 minutes.{" "}
          {can(user, "update", "settings") && (
            <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
              <Link href="/settings?tab=routes">Route settings</Link>
            </Button>
          )}
        </p>
      </div>
    </>
  );
}
