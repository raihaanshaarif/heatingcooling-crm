import { describe, expect, it } from "vitest";
import {
  affectedUsers,
  buildEventPayload,
  calendarEventId,
  diffCalendarEvents,
  eventDescription,
  eventEnd,
  eventSummary,
  freshCalendarEventId,
  hashEvent,
  jobLink,
  melbourneEventTime,
  shouldHaveEvent,
  type CalendarJob,
  type DesiredEvent,
  type ExistingEvent,
} from "./events";

const APP = "https://app.coolingservicemelbourne.com.au";
const tech = { userId: "u-tech", role: "TECHNICIAN" as const };
const office = { userId: "u-office", role: "OFFICE" as const };

function job(overrides: Partial<CalendarJob> = {}): CalendarJob {
  return {
    id: "job1",
    number: "J-0042",
    title: "Split system service",
    type: "SERVICE",
    status: "SCHEDULED",
    priority: "NORMAL",
    description: null,
    // 9:00am Melbourne in winter (AEST, +10:00)
    scheduledStart: new Date("2026-07-15T23:00:00Z"),
    scheduledEnd: new Date("2026-07-16T01:00:00Z"),
    estimatedMinutes: 120,
    deletedAt: null,
    client: { name: "Jane Smith", phone: "0412345678", altPhone: null },
    property: {
      addressLine1: "12 Smith St",
      addressLine2: null,
      suburb: "Richmond",
      state: "VIC",
      postcode: "3121",
      accessNotes: "Side gate, code 1234",
      parkingNotes: null,
      petNotes: "Friendly dog",
      keyInfo: null,
    },
    assignees: [{ userId: "u-tech", name: "Sam Tech" }],
    ...overrides,
  };
}

describe("event times (Melbourne, DST)", () => {
  it("uses +10:00 in winter (AEST)", () => {
    expect(melbourneEventTime(new Date("2026-07-15T23:00:00Z"))).toEqual({
      dateTime: "2026-07-16T09:00:00+10:00",
      timeZone: "Australia/Melbourne",
    });
  });

  it("uses +11:00 in summer (AEDT)", () => {
    expect(melbourneEventTime(new Date("2026-12-14T22:30:00Z")).dateTime).toBe(
      "2026-12-15T09:30:00+11:00",
    );
  });

  it("handles a job across the October DST change", () => {
    // 1:30am AEST on 4 Oct 2026; clocks jump 2am → 3am, so 2 hours later is 4:30am AEDT.
    const p = buildEventPayload(
      job({
        scheduledStart: new Date("2026-10-03T15:30:00Z"),
        scheduledEnd: null,
        estimatedMinutes: 120,
      }),
      tech,
      APP,
    );
    expect(p.start.dateTime).toBe("2026-10-04T01:30:00+10:00");
    expect(p.end.dateTime).toBe("2026-10-04T04:30:00+11:00");
  });

  it("handles the April change back", () => {
    // 5 Apr 2026, 3am AEDT → 2am AEST: a 9am job is +10:00.
    expect(melbourneEventTime(new Date("2026-04-04T23:00:00Z")).dateTime).toBe(
      "2026-04-05T09:00:00+10:00",
    );
    expect(melbourneEventTime(new Date("2026-04-03T22:00:00Z")).dateTime).toBe(
      "2026-04-04T09:00:00+11:00",
    );
  });

  it("works out the end when it's missing or before the start", () => {
    const start = new Date("2026-07-15T23:00:00Z");
    expect(eventEnd({ scheduledStart: start, scheduledEnd: null, estimatedMinutes: 90 })).toEqual(
      new Date("2026-07-16T00:30:00Z"),
    );
    expect(
      eventEnd({ scheduledStart: start, scheduledEnd: start, estimatedMinutes: null }),
    ).toEqual(new Date("2026-07-16T01:00:00Z"));
  });
});

describe("title", () => {
  it("is number · title · client", () => {
    expect(eventSummary(job())).toBe("J-0042 · Split system service · Jane Smith");
  });

  it("gets a tick when completed or invoiced, and a prefix on hold", () => {
    expect(eventSummary(job({ status: "COMPLETED" }))).toBe(
      "✓ J-0042 · Split system service · Jane Smith",
    );
    expect(eventSummary(job({ status: "INVOICED" }))).toMatch(/^✓ /);
    expect(eventSummary(job({ status: "ON_HOLD" }))).toMatch(/^On hold · J-0042/);
    expect(eventSummary(job({ status: "IN_PROGRESS" }))).toMatch(/^J-0042/);
  });
});

describe("description", () => {
  it("has the client phone, site, access notes and the job link", () => {
    expect(eventDescription(job(), tech, jobLink(APP, "job1", "TECHNICIAN"))).toBe(
      [
        "J-0042 · Service / Maintenance",
        "Client: Jane Smith · 0412 345 678",
        "Site: 12 Smith St, Richmond VIC 3121",
        "",
        "Access: Side gate, code 1234",
        "Pets: Friendly dog",
        "",
        `Open in CoolOps: ${APP}/my-jobs/job1`,
      ].join("\n"),
    );
  });

  it("adds priority, status, other technicians and the notes (trimmed)", () => {
    const d = eventDescription(
      job({
        priority: "EMERGENCY",
        status: "ON_HOLD",
        description: `  No cooling. ${"x".repeat(2000)}`,
        client: { name: "Jane Smith", phone: "0412345678", altPhone: "0398765432" },
        assignees: [
          { userId: "u-tech", name: "Sam Tech" },
          { userId: "u2", name: "Alex Apprentice" },
        ],
      }),
      tech,
      "L",
    );
    expect(d).toContain("Client: Jane Smith · 0412 345 678 / (03) 9876 5432");
    expect(d).toContain("Priority: Emergency");
    expect(d).toContain("Status: On hold");
    expect(d).toContain("Also on this job: Alex Apprentice");
    expect(d).not.toContain("Sam Tech");
    expect(d).toContain("Notes:\nNo cooling. xxx");
    expect(d.split("Notes:\n")[1]!.split("\n")[0]!.length).toBe(1500);
  });

  it("links office and admin to the job page", () => {
    expect(jobLink(`${APP}/`, "job1", "OFFICE")).toBe(`${APP}/jobs/job1`);
    expect(jobLink(APP, "job1", "ADMIN")).toBe(`${APP}/jobs/job1`);
    expect(jobLink(APP, "job1", "TECHNICIAN")).toBe(`${APP}/my-jobs/job1`);
  });

  it("works without a site", () => {
    const p = buildEventPayload(job({ property: null }), office, APP);
    expect(p.location).toBeUndefined();
    expect(p.description).not.toContain("Site:");
  });
});

describe("buildEventPayload", () => {
  it("builds the whole event (no prices anywhere)", () => {
    const p = buildEventPayload(job(), tech, APP);
    expect(p).toEqual({
      summary: "J-0042 · Split system service · Jane Smith",
      location: "12 Smith St, Richmond VIC 3121",
      description: expect.stringContaining("Open in CoolOps: "),
      start: { dateTime: "2026-07-16T09:00:00+10:00", timeZone: "Australia/Melbourne" },
      end: { dateTime: "2026-07-16T11:00:00+10:00", timeZone: "Australia/Melbourne" },
      status: "confirmed",
      source: { title: "CoolOps J-0042", url: `${APP}/my-jobs/job1` },
      reminders: { useDefault: true },
      extendedProperties: { private: { coolopsJobId: "job1", coolopsJobNumber: "J-0042" } },
    });
    expect(JSON.stringify(p)).not.toMatch(/\$|price|cents/i);
  });

  it("hashes stably and notices changes", () => {
    const a = hashEvent(buildEventPayload(job(), tech, APP));
    expect(hashEvent(buildEventPayload(job(), tech, APP))).toBe(a);
    expect(hashEvent(buildEventPayload(job({ status: "COMPLETED" }), tech, APP))).not.toBe(a);
  });
});

describe("shouldHaveEvent", () => {
  it("only for scheduled, live jobs assigned to the user", () => {
    expect(shouldHaveEvent(job(), "u-tech")).toBe(true);
    expect(shouldHaveEvent(job(), "someone-else")).toBe(false);
    expect(shouldHaveEvent(job({ status: "CANCELLED" }), "u-tech")).toBe(false);
    expect(shouldHaveEvent(job({ status: "UNSCHEDULED" }), "u-tech")).toBe(false);
    expect(shouldHaveEvent(job({ scheduledStart: null }), "u-tech")).toBe(false);
    expect(shouldHaveEvent(job({ deletedAt: new Date() }), "u-tech")).toBe(false);
    expect(shouldHaveEvent(job({ status: "COMPLETED" }), "u-tech")).toBe(true);
  });
});

describe("event ids", () => {
  it("are valid Google ids (base32hex, 5-1024 chars) and stable per user + job", () => {
    const id = calendarEventId("u-tech", "job1");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(calendarEventId("u-tech", "job1")).toBe(id);
    expect(calendarEventId("u2", "job1")).not.toBe(id);
    expect(freshCalendarEventId()).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(freshCalendarEventId()).not.toBe(freshCalendarEventId());
  });
});

describe("diffCalendarEvents", () => {
  const desired = (jobId: string, hash = `h-${jobId}`): DesiredEvent => ({
    jobId,
    label: jobId,
    body: buildEventPayload(job({ id: jobId }), tech, APP),
    hash,
    startsAt: new Date("2026-07-15T23:00:00Z"),
  });
  const existing = (jobId: string, hash = `h-${jobId}`, calendarId = "primary"): ExistingEvent => ({
    jobId,
    googleEventId: `ev-${jobId}`,
    calendarId,
    payloadHash: hash,
  });
  const opts = { calendarId: "primary" };

  it("creates newly assigned / scheduled jobs", () => {
    const ops = diffCalendarEvents([desired("a")], [], opts);
    expect(ops).toEqual([{ type: "create", event: desired("a") }]);
  });

  it("updates rescheduled or edited jobs and skips unchanged ones", () => {
    const ops = diffCalendarEvents(
      [desired("a", "new"), desired("b")],
      [existing("a", "old"), existing("b")],
      opts,
    );
    expect(ops).toEqual([{ type: "update", event: desired("a", "new"), googleEventId: "ev-a" }]);
  });

  it("deletes events for jobs unassigned, unscheduled, cancelled or deleted", () => {
    expect(diffCalendarEvents([], [existing("a")], opts)).toEqual([
      { type: "delete", jobId: "a", googleEventId: "ev-a", calendarId: "primary" },
    ]);
  });

  it("forced resync updates everything that exists", () => {
    const ops = diffCalendarEvents([desired("a")], [existing("a")], { ...opts, force: true });
    expect(ops.map((o) => o.type)).toEqual(["update"]);
  });

  it("moves events when the user switched calendars", () => {
    const ops = diffCalendarEvents([desired("a")], [existing("a", "h-a", "old@group")], opts);
    expect(ops).toEqual([
      { type: "delete", jobId: "a", googleEventId: "ev-a", calendarId: "old@group" },
      { type: "create", event: desired("a") },
    ]);
  });

  it("is idempotent: applying the result and diffing again gives nothing", () => {
    const want = [desired("a"), desired("b")];
    expect(diffCalendarEvents(want, [existing("a"), existing("b")], opts)).toEqual([]);
  });

  it("reassignment: the old technician's event goes, the new one's is made", () => {
    // Same job, seen from each technician's calendar after J-0042 moved from u-tech to u2.
    const moved = job({ assignees: [{ userId: "u2", name: "Alex" }] });
    const forOld = shouldHaveEvent(moved, "u-tech") ? [desired("job1")] : [];
    const forNew = shouldHaveEvent(moved, "u2") ? [desired("job1")] : [];
    expect(diffCalendarEvents(forOld, [existing("job1")], opts).map((o) => o.type)).toEqual([
      "delete",
    ]);
    expect(diffCalendarEvents(forNew, [], opts).map((o) => o.type)).toEqual(["create"]);
    expect(affectedUsers(["u2"], ["u-tech"])).toEqual(["u2", "u-tech"]);
    expect(affectedUsers(["u2", "u-tech"], ["u-tech"])).toEqual(["u2", "u-tech"]);
  });
});
