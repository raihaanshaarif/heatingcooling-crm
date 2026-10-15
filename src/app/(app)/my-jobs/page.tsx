import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { addMelbourneDays, formatDate, formatTime, startOfMelbourneDay } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getMyJobs } from "@/server/jobs/queries";
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
      />
      <div className="mx-auto max-w-2xl space-y-6">
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
