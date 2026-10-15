import { describe, expect, it, vi } from "vitest";
import {
  XeroApi,
  XeroApiError,
  XeroRateLimitError,
  parseRetryAfter,
  xeroErrorMessage,
} from "./client";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function api(
  fetchImpl: typeof fetch,
  getToken = vi.fn(async (force?: boolean) => (force ? "fresh" : "old")),
) {
  return {
    getToken,
    client: new XeroApi({
      apiUrl: "https://api.xero.com",
      tenantId: "tenant-1",
      getToken,
      fetchImpl,
      sleep: async () => undefined,
    }),
  };
}

describe("XeroApi", () => {
  it("sends auth, tenant and idempotency headers to the accounting API", async () => {
    const fetchImpl = vi.fn(async () => json(200, { Invoices: [{ InvoiceID: "i1" }] }));
    const { client } = api(fetchImpl as unknown as typeof fetch);
    const res = await client.post("/Invoices", { Invoices: [] }, { idempotencyKey: "coolops-1" });
    expect(res).toEqual({ Invoices: [{ InvoiceID: "i1" }] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.xero.com/api.xro/2.0/Invoices");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer old",
      "xero-tenant-id": "tenant-1",
      "Content-Type": "application/json",
      "Idempotency-Key": "coolops-1",
    });
    expect(init.body).toBe(JSON.stringify({ Invoices: [] }));
  });

  it("adds query parameters", async () => {
    const fetchImpl = vi.fn(async () => json(200, { Invoices: [] }));
    const { client } = api(fetchImpl as unknown as typeof fetch);
    await client.get("/Invoices", { InvoiceNumbers: "INV-0001", skip: undefined });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=INV-0001",
    );
  });

  it("refreshes the token once after a 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, null))
      .mockResolvedValueOnce(json(200, { Contacts: [] }));
    const { client, getToken } = api(fetchImpl as unknown as typeof fetch);
    await client.get("/Contacts");
    expect(getToken).toHaveBeenLastCalledWith(true);
    const second = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect((second[1].headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });

  it("turns 429 into a rate-limit error with Retry-After", async () => {
    const fetchImpl = vi.fn(async () =>
      json(429, null, { "Retry-After": "17", "X-Rate-Limit-Problem": "minute" }),
    );
    const { client } = api(fetchImpl as unknown as typeof fetch);
    const error = await client.get("/Invoices").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XeroRateLimitError);
    expect((error as XeroRateLimitError).retryAfterMs).toBe(17_000);
    expect((error as XeroRateLimitError).message).toMatch(/minute limit/);
  });

  it("reports validation errors as not retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      json(400, {
        Type: "ValidationException",
        Message: "A validation exception occurred",
        Elements: [
          {
            ValidationErrors: [
              { Message: "Account code '999' is not a valid code for this document." },
            ],
          },
        ],
      }),
    );
    const { client } = api(fetchImpl as unknown as typeof fetch);
    const error = (await client.post("/Invoices", {}).catch((e: unknown) => e)) as XeroApiError;
    expect(error).toBeInstanceOf(XeroApiError);
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Account code '999' is not a valid code for this document.");
  });

  it("treats network failures and 5xx as retryable", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = (await api(down as unknown as typeof fetch)
      .client.get("/Invoices")
      .catch((e: unknown) => e)) as XeroApiError;
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Can't reach Xero: fetch failed");

    const flaky = vi.fn(async () => json(503, null));
    const e2 = (await api(flaky as unknown as typeof fetch)
      .client.get("/Invoices")
      .catch((e: unknown) => e)) as XeroApiError;
    expect(e2.retryable).toBe(true);
  });

  it("pauses before going over the per-minute limit", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const client = new XeroApi({
      apiUrl: "https://api.xero.com",
      tenantId: "t",
      getToken: async () => "tok",
      fetchImpl: (async () => json(200, {})) as unknown as typeof fetch,
      perMinute: 3,
      sleep,
      now: () => clock,
    });
    for (let i = 0; i < 4; i++) await client.get("/Organisation");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(client.callCount).toBe(4);
  });
});

describe("helpers", () => {
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter(null)).toBe(60_000);
    const now = Date.parse("2026-10-15T00:00:00Z");
    expect(parseRetryAfter("Thu, 15 Oct 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("falls back to sensible messages", () => {
    expect(xeroErrorMessage({ Detail: "TenantId is not valid" }, 403)).toBe(
      "TenantId is not valid",
    );
    expect(xeroErrorMessage(null, 404)).toBe("Not found in Xero");
    expect(xeroErrorMessage(null, 418)).toBe("Xero returned HTTP 418");
  });
});
