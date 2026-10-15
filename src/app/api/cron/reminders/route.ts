import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyReminders } from "@/server/cron/reminders";

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
 */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const summary = await runDailyReminders();
  console.info("[cron] reminders", summary);
  return NextResponse.json({ ok: true, ...summary });
}

export const POST = GET;
