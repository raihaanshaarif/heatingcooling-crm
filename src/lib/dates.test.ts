import { describe, expect, it } from "vitest";
import {
  addMelbourneDays,
  addMelbourneMonths,
  endOfMelbourneDay,
  formatDateTime,
  fromMelbourneInput,
  startOfMelbourneDay,
  startOfMelbourneMonth,
  startOfMelbourneWeek,
  toDateTimeInput,
} from "./dates";

describe("Melbourne dates", () => {
  it("round-trips wall clock input", () => {
    const d = fromMelbourneInput("2025-01-15T09:30");
    expect(d.toISOString()).toBe("2025-01-14T22:30:00.000Z"); // AEDT +11
    expect(toDateTimeInput(d)).toBe("2025-01-15T09:30");
    expect(fromMelbourneInput("2025-07-15T09:30").toISOString()).toBe("2025-07-14T23:30:00.000Z"); // AEST +10
  });

  it("formats in Melbourne time regardless of server zone", () => {
    expect(formatDateTime(new Date("2025-01-14T22:30:00Z"))).toBe("15 Jan 2025, 9:30 AM");
  });

  it("finds day, week and month boundaries", () => {
    const d = fromMelbourneInput("2025-06-18T15:00"); // Wednesday
    expect(startOfMelbourneDay(d).toISOString()).toBe("2025-06-17T14:00:00.000Z");
    expect(endOfMelbourneDay(d).toISOString()).toBe("2025-06-18T13:59:59.999Z");
    expect(startOfMelbourneWeek(d).toISOString()).toBe("2025-06-15T14:00:00.000Z");
    expect(startOfMelbourneMonth(d).toISOString()).toBe("2025-05-31T14:00:00.000Z");
    expect(startOfMelbourneMonth(d, -1).toISOString()).toBe("2025-04-30T14:00:00.000Z");
  });

  it("keeps wall-clock time across daylight saving", () => {
    const before = fromMelbourneInput("2025-04-05T09:00");
    expect(toDateTimeInput(addMelbourneDays(before, 1))).toBe("2025-04-06T09:00");
    expect(toDateTimeInput(addMelbourneMonths(fromMelbourneInput("2025-01-31T08:00"), 1))).toBe(
      "2025-02-28T08:00",
    );
    expect(toDateTimeInput(addMelbourneMonths(fromMelbourneInput("2025-03-15T08:00"), 12))).toBe(
      "2026-03-15T08:00",
    );
  });
});
