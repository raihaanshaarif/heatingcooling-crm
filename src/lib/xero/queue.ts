/**
 * Retry policy for the Xero sync outbox (pure, unit-tested). Each failed attempt waits
 * longer; validation errors fail straight away (retrying can't fix them, someone has to
 * change the record or the mapping and click Retry); a 429 waits for Xero's Retry-After
 * without using up an attempt.
 */

export const MAX_ATTEMPTS = 6;

/** Wait after the nth failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1]!;
}

/** A PROCESSING job whose worker died is picked up again after this long. */
export const STALE_LOCK_MS = 10 * 60_000;

export interface SyncFailure {
  message: string;
  retryable: boolean;
  /** Set for HTTP 429: wait this long and don't count the attempt. */
  retryAfterMs?: number;
}

export interface JobState {
  attempts: number;
}

export interface NextJobState {
  status: "PENDING" | "FAILED";
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
  /** True when the whole run should stop (rate limited: every call would fail). */
  stopRun: boolean;
}

export function nextStateAfterFailure(
  job: JobState,
  failure: SyncFailure,
  now = new Date(),
): NextJobState {
  if (failure.retryAfterMs !== undefined) {
    return {
      status: "PENDING",
      attempts: job.attempts,
      nextAttemptAt: new Date(now.getTime() + failure.retryAfterMs),
      lastError: failure.message,
      stopRun: true,
    };
  }
  const attempts = job.attempts + 1;
  const giveUp = !failure.retryable || attempts >= MAX_ATTEMPTS;
  return {
    status: giveUp ? "FAILED" : "PENDING",
    attempts,
    nextAttemptAt: giveUp ? now : new Date(now.getTime() + backoffMs(attempts)),
    lastError: failure.message,
    stopRun: false,
  };
}

/**
 * Which kinds of job may be merged when queued again: a second "push invoice" while the
 * first is still waiting is the same work. Deletes and payments are never merged.
 */
export function canMergeJobs(kind: string): boolean {
  return (
    kind === "CONTACT" || kind === "INVOICE" || kind === "CREDIT_NOTE" || kind === "VOID_INVOICE"
  );
}
