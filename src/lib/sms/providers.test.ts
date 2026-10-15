import { describe, expect, it, vi } from "vitest";
import {
  buildMessageMediaRequest,
  buildTwilioRequest,
  createSmsProvider,
  parseMessageMediaResponse,
  parseTwilioResponse,
  readSmsConfig,
  type MessageMediaConfig,
  type TwilioConfig,
} from "./providers";

const msg = { to: "+61412345678", body: "Hi Sarah, Jack is on the way & will be 10 mins." };
const twilio: TwilioConfig = {
  provider: "twilio",
  accountSid: "AC123",
  authToken: "secret",
  from: "+61400000000",
};
const mm: MessageMediaConfig = { provider: "messagemedia", apiKey: "key", apiSecret: "shh" };

const b64 = (s: string) => Buffer.from(s).toString("base64");

function mockFetch(status: number, json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status }));
}

describe("readSmsConfig", () => {
  it("uses the console provider when nothing is set", () => {
    expect(readSmsConfig({})).toEqual({ provider: "console", missing: [] });
  });

  it("falls back to console and lists missing Twilio settings", () => {
    expect(readSmsConfig({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1" })).toEqual({
      provider: "console",
      requested: "twilio",
      missing: ["TWILIO_AUTH_TOKEN", "SMS_FROM (or TWILIO_MESSAGING_SERVICE_SID)"],
    });
  });

  it("reads Twilio with a number or a Messaging Service SID", () => {
    const base = { SMS_PROVIDER: "Twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" };
    expect(readSmsConfig({ ...base, SMS_FROM: "+61400000000" })).toMatchObject({
      provider: "twilio",
      from: "+61400000000",
      messagingServiceSid: undefined,
    });
    expect(readSmsConfig({ ...base, SMS_FROM: "MG999" })).toMatchObject({
      provider: "twilio",
      from: undefined,
      messagingServiceSid: "MG999",
    });
  });

  it("reads MessageMedia; the sender is optional", () => {
    expect(
      readSmsConfig({
        SMS_PROVIDER: "messagemedia",
        MESSAGEMEDIA_API_KEY: "k",
        MESSAGEMEDIA_API_SECRET: "s",
      }),
    ).toEqual({ provider: "messagemedia", apiKey: "k", apiSecret: "s", from: undefined });
    expect(readSmsConfig({ SMS_PROVIDER: "messagemedia" })).toMatchObject({
      provider: "console",
      missing: ["MESSAGEMEDIA_API_KEY", "MESSAGEMEDIA_API_SECRET"],
    });
  });
});

describe("Twilio", () => {
  it("builds a form-encoded Messages.json request with basic auth", () => {
    const req = buildTwilioRequest(twilio, msg);
    expect(req.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers.Authorization).toBe(`Basic ${b64("AC123:secret")}`);
    expect(req.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(req.init.body);
    expect(form.get("To")).toBe("+61412345678");
    expect(form.get("From")).toBe("+61400000000");
    expect(form.get("Body")).toBe(msg.body);
    expect(form.has("MessagingServiceSid")).toBe(false);
  });

  it("uses MessagingServiceSid instead of From when configured", () => {
    const form = new URLSearchParams(
      buildTwilioRequest({ ...twilio, from: undefined, messagingServiceSid: "MG1" }, msg).init.body,
    );
    expect(form.get("MessagingServiceSid")).toBe("MG1");
    expect(form.has("From")).toBe(false);
  });

  it("parses success and error responses", () => {
    expect(parseTwilioResponse(201, { sid: "SM1", status: "queued" })).toEqual({
      status: "SENT",
      id: "SM1",
    });
    expect(
      parseTwilioResponse(400, { code: 21211, message: "The 'To' number is not valid." }),
    ).toEqual({ status: "FAILED", error: "Twilio (21211): The 'To' number is not valid." });
    expect(parseTwilioResponse(500, null)).toEqual({ status: "FAILED", error: "Twilio: HTTP 500" });
  });

  it("sends through fetch and returns the message SID", async () => {
    const fetchImpl = mockFetch(201, { sid: "SM42", status: "queued" });
    const result = await createSmsProvider(twilio, fetchImpl).send(msg);
    expect(result).toEqual({ status: "SENT", id: "SM42" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/Accounts/AC123/Messages.json");
    expect(init.method).toBe("POST");
  });

  it("turns network errors into FAILED instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    expect(await createSmsProvider(twilio, fetchImpl).send(msg)).toEqual({
      status: "FAILED",
      error: "Twilio: getaddrinfo ENOTFOUND",
    });
  });
});

describe("MessageMedia", () => {
  it("builds a JSON v1/messages request with basic auth", () => {
    const req = buildMessageMediaRequest(mm, msg);
    expect(req.url).toBe("https://api.messagemedia.com/v1/messages");
    expect(req.init.headers.Authorization).toBe(`Basic ${b64("key:shh")}`);
    expect(req.init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.init.body)).toEqual({
      messages: [{ content: msg.body, destination_number: "+61412345678", format: "SMS" }],
    });
  });

  it("adds the sender with the right number type", () => {
    const num = JSON.parse(
      buildMessageMediaRequest({ ...mm, from: "+61400000000" }, msg).init.body,
    );
    expect(num.messages[0]).toMatchObject({
      source_number: "+61400000000",
      source_number_type: "INTERNATIONAL",
    });
    const alpha = JSON.parse(
      buildMessageMediaRequest({ ...mm, from: "CoolService" }, msg).init.body,
    );
    expect(alpha.messages[0]).toMatchObject({
      source_number: "CoolService",
      source_number_type: "ALPHANUMERIC",
    });
  });

  it("parses success and error responses", () => {
    expect(
      parseMessageMediaResponse(202, { messages: [{ message_id: "abc-123", status: "queued" }] }),
    ).toEqual({ status: "SENT", id: "abc-123" });
    expect(
      parseMessageMediaResponse(400, {
        message: "Invalid message request.",
        details: ["destination_number is invalid"],
      }),
    ).toEqual({
      status: "FAILED",
      error: "MessageMedia: Invalid message request. destination_number is invalid",
    });
  });

  it("sends through fetch", async () => {
    const fetchImpl = mockFetch(202, { messages: [{ message_id: "m-1" }] });
    expect(await createSmsProvider(mm, fetchImpl).send(msg)).toEqual({ status: "SENT", id: "m-1" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.messagemedia.com/v1/messages");
  });
});

describe("console provider", () => {
  it("logs instead of calling any API", async () => {
    const fetchImpl = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await createSmsProvider({ provider: "console", missing: [] }, fetchImpl).send(
      msg,
    );
    expect(result).toEqual({ status: "LOGGED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("+61412345678"));
    info.mockRestore();
  });
});
