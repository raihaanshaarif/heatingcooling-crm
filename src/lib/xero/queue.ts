/**
 * Retry policy for the Xero sync outbox (pure, unit-tested). Each failed attempt waits
 * longer; validation errors fail straight away (retrying can't fix them, someone has to
 * change the record or the mapping and click Retry); a 429 waits for Xero's Retry-After
 * without using up an attempt.
 */

export {
  MAX_ATTEMPTS,
  STALE_LOCK_MS,
  backoffMs,
  nextStateAfterFailure,
  type JobState,
  type NextJobState,
  type SyncFailure,
} from "@/lib/outbox";

/**
 * Which kinds of job may be merged when queued again: a second "push invoice" while the
 * first is still waiting is the same work. Deletes and payments are never merged.
 */
export function canMergeJobs(kind: string): boolean {
  return (
    kind === "CONTACT" || kind === "INVOICE" || kind === "CREDIT_NOTE" || kind === "VOID_INVOICE"
  );
}
