import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, backoffMs, canMergeJobs, nextStateAfterFailure } from "./queue";

const now = new Date("2026-10-15T00:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

describe("backoffMs", () => {
  it("waits longer after each failure and caps at 6 hours", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(backoffMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 21_600_000, 21_600_000,
    ]);
    expect(backoffMs(0)).toBe(60_000);
  });
});

describe("nextStateAfterFailure", () => {
  it("retries a network error with backoff", () => {
    expect(
      nextStateAfterFailure({ attempts: 0 }, { message: "Can't reach Xero", retryable: true }, now),
    ).toEqual({
      status: "PENDING",
      attempts: 1,
      nextAttemptAt: later(60_000),
      lastError: "Can't reach Xero",
      stopRun: false,
    });
    expect(
      nextStateAfterFailure({ attempts: 2 }, { message: "HTTP 503", retryable: true }, now)
        .nextAttemptAt,
    ).toEqual(later(1_800_000));
  });

  it("gives up after the maximum attempts", () => {
    const state = nextStateAfterFailure(
      { attempts: MAX_ATTEMPTS - 1 },
      { message: "HTTP 500", retryable: true },
      now,
    );
    expect(state.status).toBe("FAILED");
    expect(state.attempts).toBe(MAX_ATTEMPTS);
  });

  it("fails validation errors straight away", () => {
    const state = nextStateAfterFailure(
      { attempts: 0 },
      { message: "Account code '999' is not a valid code", retryable: false },
      now,
    );
    expect(state).toMatchObject({ status: "FAILED", attempts: 1, stopRun: false });
  });

  it("honours Retry-After on 429 without using up an attempt, and stops the run", () => {
    expect(
      nextStateAfterFailure(
        { attempts: 3 },
        { message: "rate limited", retryable: true, retryAfterMs: 42_000 },
        now,
      ),
    ).toEqual({
      status: "PENDING",
      attempts: 3,
      nextAttemptAt: later(42_000),
      lastError: "rate limited",
      stopRun: true,
    });
  });
});

describe("canMergeJobs", () => {
  it("merges repeat pushes but never payments or deletes", () => {
    expect(canMergeJobs("INVOICE")).toBe(true);
    expect(canMergeJobs("CONTACT")).toBe(true);
    expect(canMergeJobs("PAYMENT")).toBe(false);
    expect(canMergeJobs("DELETE_PAYMENT")).toBe(false);
  });
});
