import { describe, expect, it, vi } from "vitest";
import { GoogleApiError, GoogleCalendarApi, GoogleRateLimitError } from "./client";
import { buildEventPayload, type CalendarJob } from "./events";

const API = "http://mock/calendar/v3";

const body = buildEventPayload(
  {
    id: "job1",
    number: "J-0042",
    title: "Split system service",
    type: "SERVICE",
    status: "SCHEDULED",
    priority: "NORMAL",
    description: null,
    scheduledStart: new Date("2026-07-15T23:00:00Z"),
    scheduledEnd: null,
    estimatedMinutes: 60,
    deletedAt: null,
    client: { name: "Jane", phone: null, altPhone: null },
    property: null,
    assignees: [{ userId: "u", name: "Sam" }],
  } satisfies CalendarJob,
  { userId: "u", role: "TECHNICIAN" },
  "https://app",
);

function setup(responses: Response[]) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  });
  const getToken = vi.fn(async (force?: boolean) => (force ? "fresh-token" : "old-token"));
  const api = new GoogleCalendarApi({
    apiUrl: API,
    getToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => 0,
  });
  return { api, fetchImpl, getToken };
}

const call = (fetchImpl: ReturnType<typeof setup>["fetchImpl"], i = 0) => {
  const [url, init] = fetchImpl.mock.calls[i]!;
  return { url: String(url), init: init! };
};

describe("GoogleCalendarApi", () => {
  it("inserts an event with our id into the user's calendar", async () => {
    const { api, fetchImpl } = setup([Response.json({ id: "coolopsabc", status: "confirmed" })]);
    const res = await api.insertEvent("primary", { ...body, id: "coolopsabc" });
    expect(res.id).toBe("coolopsabc");
    const { url, init } = call(fetchImpl);
    expect(url).toBe(`${API}/calendars/primary/events?sendUpdates=none`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer old-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      id: "coolopsabc",
      summary: "J-0042 · Split system service · Jane",
    });
  });

  it("updates with PUT and deletes with DELETE, escaping ids", async () => {
    const { api, fetchImpl } = setup([
      Response.json({ id: "ev1" }),
      new Response(null, { status: 204 }),
    ]);
    await api.updateEvent("team@group.calendar.google.com", "ev1", body);
    await api.deleteEvent("primary", "ev1");
    expect(call(fetchImpl, 0).url).toBe(
      `${API}/calendars/team%40group.calendar.google.com/events/ev1?sendUpdates=none`,
    );
    expect(call(fetchImpl, 0).init.method).toBe("PUT");
    expect(call(fetchImpl, 1).init.method).toBe("DELETE");
  });

  it("refreshes the token once on 401", async () => {
    const { api, fetchImpl, getToken } = setup([
      Response.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 }),
      Response.json({ id: "ev1" }),
    ]);
    await api.updateEvent("primary", "ev1", body);
    expect(getToken).toHaveBeenLastCalledWith(true);
    expect(call(fetchImpl, 1).init.headers).toMatchObject({ Authorization: "Bearer fresh-token" });
  });

  it("keeps 404 / 410 / 409 as statuses the sync can act on", async () => {
    const { api } = setup([
      Response.json(
        { error: { code: 410, message: "Resource has been deleted" } },
        { status: 410 },
      ),
      Response.json({ error: { code: 404, message: "Not Found" } }, { status: 404 }),
      Response.json(
        { error: { code: 409, message: "The requested identifier already exists." } },
        { status: 409 },
      ),
    ]);
    await expect(api.updateEvent("primary", "gone", body)).rejects.toMatchObject({
      status: 410,
      retryable: false,
      message: "Google Calendar: Resource has been deleted",
    });
    await expect(api.deleteEvent("primary", "x")).rejects.toMatchObject({ status: 404 });
    await expect(api.insertEvent("primary", { ...body, id: "dup" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("turns 429 and 403 rate-limit reasons into a rate limit with Retry-After", async () => {
    const { api } = setup([
      new Response("{}", { status: 429, headers: { "Retry-After": "12" } }),
      Response.json(
        {
          error: {
            code: 403,
            message: "Rate Limit Exceeded",
            errors: [{ reason: "userRateLimitExceeded" }],
          },
        },
        { status: 403 },
      ),
    ]);
    const a = await api.insertEvent("primary", body).catch((e: unknown) => e);
    expect(a).toBeInstanceOf(GoogleRateLimitError);
    expect((a as GoogleRateLimitError).retryAfterMs).toBe(12_000);
    const b = await api.insertEvent("primary", body).catch((e: unknown) => e);
    expect(b).toBeInstanceOf(GoogleRateLimitError);
    expect((b as GoogleRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("a plain 403 is not retried; 5xx and network errors are", async () => {
    const { api } = setup([
      Response.json(
        { error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] } },
        { status: 403 },
      ),
      new Response("oops", { status: 503 }),
    ]);
    await expect(api.insertEvent("primary", body)).rejects.toMatchObject({
      status: 403,
      retryable: false,
      reason: "forbidden",
    });
    await expect(api.insertEvent("primary", body)).rejects.toMatchObject({
      status: 503,
      retryable: true,
      message: "Google Calendar returned HTTP 503",
    });
    const offline = new GoogleCalendarApi({
      apiUrl: API,
      getToken: async () => "t",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const e = await offline.deleteEvent("primary", "x").catch((err: unknown) => err);
    expect(e).toBeInstanceOf(GoogleApiError);
    expect(e).toMatchObject({ status: 0, retryable: true });
  });
});
