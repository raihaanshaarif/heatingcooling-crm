import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit in a window then blocks", () => {
    const t = 1_000_000;
    expect(rateLimit("ip", 3, 60_000, t).ok).toBe(true);
    expect(rateLimit("ip", 3, 60_000, t + 1).ok).toBe(true);
    expect(rateLimit("ip", 3, 60_000, t + 2).remaining).toBe(0);
    const blocked = rateLimit("ip", 3, 60_000, t + 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("frees up after the window passes and keys are independent", () => {
    const t = 2_000_000;
    rateLimit("a", 1, 1000, t);
    expect(rateLimit("a", 1, 1000, t + 10).ok).toBe(false);
    expect(rateLimit("b", 1, 1000, t + 10).ok).toBe(true);
    expect(rateLimit("a", 1, 1000, t + 1001).ok).toBe(true);
  });
});
