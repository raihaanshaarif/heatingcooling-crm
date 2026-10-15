import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Clock, MapPin, Navigation, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import {
  addMelbourneDays,
  formatDate,
  formatTime,
  fromMelbourneInput,
  startOfMelbourneDay,
  toDateInput,
} from "@/lib/dates";
import { getDayRouteLinks } from "@/server/routes/service";
import { formatAddress } from "@/lib/utils";
import { getMyJobs } from "@/server/jobs/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { JobStatusBadge, PriorityBadge } from "@/components/shared/status-badge";

export const metadata: Metadata = { title: "My jobs" };

type MyJob = Awaited<ReturnType<typeof getMyJobs>>[number];

function JobCard({ job }: { job: MyJob }) {
  return (
    <Link href={`/my-jobs/${job.id}`} className="block">
      <Card className="hover:bg-muted/40 py-4 transition">
        <CardContent className="flex items-center gap-3 px-4">
          <div className="w-16 shrink-0 text-center">
            {job.scheduledStart ? (
              <>
                <p className="text-lg font-semibold tabular-nums">
                  {formatTime(job.scheduledStart)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDate(job.scheduledStart, "EEE d MMM")}
                </p>
              </>
            ) : (
              <Clock className="text-muted-foreground mx-auto" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{job.client.name}</span>
              <JobStatusBadge status={job.status} />
              <PriorityBadge priority={job.priority} />
            </div>
            <p className="truncate text-sm">{job.title}</p>
            {job.property && (
              <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                <MapPin className="size-3 shrink-0" /> {formatAddress(job.property)}
              </p>
            )}
          </div>
          <ChevronRight className="text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function MyJobsPage() {
  const user = await requirePermission("view", "myJobs");
  const today = startOfMelbourneDay();
  const tomorrow = addMelbourneDays(today, 1);
  const jobs = await getMyJobs(user.id, today);
  const active = jobs.filter((j) => ["EN_ROUTE", "IN_PROGRESS", "ON_HOLD"].includes(j.status));
  const overdue = jobs.filter(
    (j) => !active.includes(j) && j.scheduledStart && j.scheduledStart < today,
  );
  const todays = jobs.filter(
    (j) =>
      !active.includes(j) &&
      j.scheduledStart &&
      j.scheduledStart >= today &&
      j.scheduledStart < tomorrow,
  );
  const upcoming = jobs.filter(
    (j) => !active.includes(j) && j.scheduledStart && j.scheduledStart >= tomorrow,
  );
  // Today's route in Google Maps, in booked order (works without any API key).
  const canRoute = can(user, "view", "routes");
  const route =
    canRoute && todays.length + active.length > 0
      ? await getDayRouteLinks(user.id, toDateInput(today))
      : null;
  // …and for the next few days with work, so the night before they can check tomorrow's run.
  const nextDays = [
    ...new Set(upcoming.map((j) => (j.scheduledStart ? toDateInput(j.scheduledStart) : ""))),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const nextRoutes = canRoute
    ? await Promise.all(
        nextDays.map(async (day) => ({ day, ...(await getDayRouteLinks(user.id, day)) })),
      )
    : [];
  const groups = [
    { title: "In progress", jobs: active },
    { title: "Missed / not closed", jobs: overdue },
    { title: `Today · ${formatDate(today, "EEEE d MMMM")}`, jobs: todays, always: true },
    { title: "Upcoming", jobs: upcoming },
  ];
  return (
    <>
      <PageHeader
        title={`G'day, ${user.name.split(" ")[0]}`}
        description={`${todays.length} job${todays.length === 1 ? "" : "s"} today`}
        actions={
          user.role === "TECHNICIAN" && (
            <Button asChild variant="outline" size="sm">
              <Link href="/my-jobs/van">
                <Truck /> My van stock
              </Link>
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-2xl space-y-6">
        {route && route.urls.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="my-route">
            {route.urls.map((url, i) => (
              <Button key={url} asChild className="h-11 flex-1">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <Navigation /> Open today&apos;s route in Google Maps
                  {route.urls.length > 1 ? ` (${i + 1}/${route.urls.length})` : ""}
                </a>
              </Button>
            ))}
            <p className="text-muted-foreground w-full text-xs">
              {route.stops} stop{route.stops === 1 ? "" : "s"} in booked order, then back to the
              start.
            </p>
          </div>
        )}
        {nextRoutes.some((r) => r.urls.length) && (
          <div className="flex flex-wrap gap-2" data-testid="next-route">
            {nextRoutes.flatMap((r) =>
              r.urls.map((url, i) => (
                <Button key={url} asChild variant="outline" size="sm">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <Navigation /> {formatDate(fromMelbourneInput(r.day), "EEE d MMM")} route (
                    {r.stops} stop{r.stops === 1 ? "" : "s"})
                    {r.urls.length > 1 ? ` ${i + 1}/${r.urls.length}` : ""}
                  </a>
                </Button>
              )),
            )}
          </div>
        )}
        {groups
          .filter((g) => g.jobs.length > 0 || g.always)
          .map((g) => (
            <section key={g.title} className="space-y-2">
              <h2 className="text-muted-foreground text-sm font-medium">{g.title}</h2>
              {g.jobs.length === 0 ? (
                <EmptyState
                  title="No jobs today"
                  description="Check with the office if you're expecting work."
                />
              ) : (
                g.jobs.map((j) => <JobCard key={j.id} job={j} />)
              )}
            </section>
          ))}
      </div>
    </>
  );
}
