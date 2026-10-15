import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyReminders } from "@/server/cron/reminders";
import { runCalendarCron } from "@/server/google-calendar/sync";
import { runXeroCron } from "@/server/xero/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily reminders. A Coolify scheduled task (`pnpm cron:reminders`) calls this
 * with `Authorization: Bearer $CRON_SECRET`.
 * Safe to run more than once a day: every reminder is de-duplicated.
 * Then pushes waiting Xero sync jobs (when connected with automatic sync on) and refreshes
 * the Xero connection so it never lapses, then checks every connected Google Calendar for the
 * next 60 days (only changed events are sent) and retries waiting calendar updates.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const summary = await runDailyReminders();
  console.info("[cron] reminders", summary);
  let xero: unknown;
  try {
    xero = await runXeroCron();
  } catch (error) {
    console.error("[cron] xero sync failed", error);
    xero = { error: error instanceof Error ? error.message : String(error) };
  }
  let googleCalendar: unknown;
  try {
    googleCalendar = await runCalendarCron();
  } catch (error) {
    console.error("[cron] google calendar sync failed", error);
    googleCalendar = { error: error instanceof Error ? error.message : String(error) };
  }
  return NextResponse.json({ ok: true, ...summary, xero, googleCalendar });
}

export const POST = GET;
