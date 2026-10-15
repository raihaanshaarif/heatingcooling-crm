"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { UserError, runAction } from "@/server/action";
import { audit } from "@/server/audit";
import { getCalendarConnection, revokeAndDeleteConnection } from "./connection";
import { kickCalendarSync, queueUserResync } from "./queue";
import { processCalendarQueue, removeUpcomingEvents, type CalendarRunResult } from "./sync";

const emptySchema = z.object({});
const disconnectSchema = z.object({ removeEvents: z.boolean().default(true) });

function revalidateCalendar() {
  revalidatePath("/account");
  revalidatePath("/integrations");
  revalidatePath("/team");
}

function describeRun(r: CalendarRunResult): string {
  if (!r.ran) return r.reason ?? "Nothing to sync.";
  const changes = r.notes.filter((n) => !n.endsWith("Already up to date"));
  if (r.failed) return `Calendar sync had a problem: ${r.notes.at(-1) ?? "unknown error"}`;
  if (r.rateLimited) return "Google asked us to slow down; the rest will follow shortly.";
  if (changes.length === 0) return "Your calendar is up to date.";
  return `Calendar updated: ${changes.map((n) => n.replace(/^[^:]+: /, "")).join("; ")}.`;
}

/** "Resync my calendar": re-send the next 60 days of the user's jobs now. */
export async function resyncMyCalendar(input: z.input<typeof emptySchema>) {
  return runAction({ schema: emptySchema }, input, async (_d, user) => {
    const conn = await getCalendarConnection(user.id);
    if (!conn) throw new UserError("Connect Google Calendar first.");
    if (conn.needsReconnect)
      throw new UserError("Google needs you to connect again: click Reconnect Google Calendar.");
    await queueUserResync(db, user.id, true);
    const run = await processCalendarQueue({
      userId: user.id,
      force: true,
      maxTasks: 50,
      timeBudgetMs: 25_000,
    });
    revalidateCalendar();
    return { message: describeRun(run), failed: run.failed > 0 };
  });
}

/** Disconnect: optionally remove upcoming CoolOps events, revoke Google's grant, forget tokens. */
export async function disconnectMyGoogleCalendar(input: z.input<typeof disconnectSchema>) {
  return runAction({ schema: disconnectSchema }, input, async ({ removeEvents }, user) => {
    const conn = await getCalendarConnection(user.id);
    if (!conn) return { message: "Google Calendar wasn't connected." };
    const cleanup = removeEvents ? await removeUpcomingEvents(user.id) : null;
    const { revoked, error } = await revokeAndDeleteConnection(user.id);
    await audit(db, {
      userId: user.id,
      action: "GOOGLE_CALENDAR_DISCONNECT",
      entityType: "USER",
      entityId: user.id,
      changes: { googleEmail: conn.googleEmail, revoked, removedEvents: cleanup?.removed ?? 0 },
    });
    revalidateCalendar();
    const parts = ["Google Calendar disconnected."];
    if (cleanup)
      parts.push(
        cleanup.left
          ? `Removed ${cleanup.removed} upcoming job${cleanup.removed === 1 ? "" : "s"}; ${cleanup.left} couldn't be removed, delete them in Google Calendar.`
          : `Removed ${cleanup.removed} upcoming job${cleanup.removed === 1 ? "" : "s"} from your calendar.`,
      );
    if (!revoked && error)
      parts.push(
        "Google didn't confirm the access was removed; you can remove CoolOps at myaccount.google.com → Security → Third-party connections.",
      );
    return { message: parts.join(" ") };
  });
}

/** Admin: retry every failed calendar task now. */
export async function retryFailedCalendarTasks(input: z.input<typeof emptySchema>) {
  return runAction({ schema: emptySchema, permission: ["update", "settings"] }, input, async () => {
    const { count } = await db.googleCalendarTask.updateMany({
      where: { status: "FAILED", user: { googleCalendar: { is: { needsReconnect: false } } } },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() },
    });
    kickCalendarSync();
    revalidateCalendar();
    return {
      message: count
        ? `Retrying ${count} calendar update${count === 1 ? "" : "s"}.`
        : "Nothing to retry (users who need to reconnect have to do that first).",
    };
  });
}
