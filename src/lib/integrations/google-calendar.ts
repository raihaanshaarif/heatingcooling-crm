import "server-only";

/**
 * Phase 3: Google Calendar sync for technicians.
 *
 * TODO(Phase 3): OAuth per technician (Auth.js Google provider with the calendar.events
 * scope), then on job create / reschedule / unschedule upsert an event in the tech's
 * calendar keyed by job id (extendedProperties.private.jobId). Hook points:
 * createJob, updateJob, rescheduleJob, unscheduleJob in src/server/jobs/actions.ts.
 */
export function isGoogleCalendarConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export async function syncJobToCalendar(_jobId: string): Promise<void> {
  // Intentionally a no-op until Phase 3.
}
