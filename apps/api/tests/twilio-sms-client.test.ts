import { afterEach, describe, expect, it, vi } from "vitest";
import { createTwilioSmsClient } from "../src/services/twilio-sms-client.js";
import { TwilioSmsApiError } from "../src/services/twilio-sms-client-types.js";

const ACCOUNT_SID = "ACtest0000000000000000000000000000";
const AUTH_TOKEN = "test-auth-token-do-not-use-in-prod";
const MESSAGES_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

function fakeResponse(overrides: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  retryAfter?: string | null;
}) {
  return {
    ok: overrides.ok,
    status: overrides.status,
    json: overrides.json,
    headers: { get: (name: string) => (name === "Retry-After" ? (overrides.retryAfter ?? null) : null) },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createTwilioSmsClient().sendSms", () => {
  it("sends the expected request shape (endpoint, Basic Auth, form-encoded body)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      fakeResponse({ ok: true, status: 201, json: async () => ({ sid: "SM123", status: "queued" }) }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    await client.sendSms({
      to: "+15551234567",
      from: "+15559876543",
      body: "hello",
      statusCallbackUrl: "https://api.example.com/twilio/sms-status",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      MESSAGES_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`,
        }),
      }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentParams = init.body as URLSearchParams;
    expect(sentParams.get("To")).toBe("+15551234567");
    expect(sentParams.get("From")).toBe("+15559876543");
    expect(sentParams.get("Body")).toBe("hello");
    expect(sentParams.get("StatusCallback")).toBe("https://api.example.com/twilio/sms-status");
  });

  it("returns the sid and initial status on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({ ok: true, status: 201, json: async () => ({ sid: "SM999", status: "queued" }) }),
      ),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    const result = await client.sendSms({
      to: "+15551234567",
      from: "+15559876543",
      body: "hello",
      statusCallbackUrl: "https://api.example.com/twilio/sms-status",
    });
    expect(result).toEqual({ sid: "SM999", status: "queued" });
  });

  it("throws TwilioSmsApiError with httpStatus/twilioErrorCode on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 400,
          json: async () => ({ code: 21211, message: "Invalid 'To' Phone Number" }),
        }),
      ),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    let caught: TwilioSmsApiError | undefined;
    try {
      await client.sendSms({
        to: "not-a-number",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      });
    } catch (err) {
      caught = err as TwilioSmsApiError;
    }
    expect(caught).toBeInstanceOf(TwilioSmsApiError);
    expect(caught?.httpStatus).toBe(400);
    expect(caught?.twilioErrorCode).toBe(21211);
    expect(caught?.retryAfterMs).toBeNull();
  });

  it("parses a numeric Retry-After header (seconds) into retryAfterMs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 429,
          json: async () => ({ code: 20429 }),
          retryAfter: "30",
        }),
      ),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    let caught: TwilioSmsApiError | undefined;
    try {
      await client.sendSms({
        to: "+15551234567",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      });
    } catch (err) {
      caught = err as TwilioSmsApiError;
    }
    expect(caught).toBeInstanceOf(TwilioSmsApiError);
    expect(caught?.httpStatus).toBe(429);
    expect(caught?.retryAfterMs).toBe(30_000);
  });

  it("ignores a malformed Retry-After header rather than guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 429, json: async () => ({}), retryAfter: "not-a-value" }),
      ),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    let caught: TwilioSmsApiError | undefined;
    try {
      await client.sendSms({
        to: "+15551234567",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      });
    } catch (err) {
      caught = err as TwilioSmsApiError;
    }
    expect(caught?.retryAfterMs).toBeNull();
  });

  it("throws TwilioSmsApiError (network failure) when fetch itself rejects, with no HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    let caught: TwilioSmsApiError | undefined;
    try {
      await client.sendSms({
        to: "+15551234567",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      });
    } catch (err) {
      caught = err as TwilioSmsApiError;
    }
    expect(caught).toBeInstanceOf(TwilioSmsApiError);
    expect(caught?.httpStatus).toBeNull();
    expect(caught?.twilioErrorCode).toBeNull();
  });

  it("throws TwilioSmsApiError when the success response body is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeResponse({ ok: true, status: 201, json: async () => ({}) })),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    await expect(
      client.sendSms({
        to: "+15551234567",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      }),
    ).rejects.toBeInstanceOf(TwilioSmsApiError);
  });

  it("never includes the auth token in a thrown error's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 401, json: async () => ({ code: 20003 }) }),
      ),
    );
    const client = createTwilioSmsClient(ACCOUNT_SID, AUTH_TOKEN);
    let caught: TwilioSmsApiError | undefined;
    try {
      await client.sendSms({
        to: "+15551234567",
        from: "+15559876543",
        body: "hello",
        statusCallbackUrl: "https://api.example.com/twilio/sms-status",
      });
    } catch (err) {
      caught = err as TwilioSmsApiError;
    }
    expect(caught?.message).not.toContain(AUTH_TOKEN);
  });
});
