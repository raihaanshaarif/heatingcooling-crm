// Runs the daily reminders against the running app. Used by Coolify's
// scheduled task: `pnpm cron:reminders` inside the app container.
const port = process.env.PORT ?? "3000";
const url = process.env.CRON_URL ?? `http://127.0.0.1:${port}/api/cron/reminders`;
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(1);
}

const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
