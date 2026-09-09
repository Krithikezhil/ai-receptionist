import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "../src/services/google-calendar-client.js";
import { GoogleCalendarApiError } from "../src/services/google-calendar-client-types.js";

const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOKEN = "test-access-token-do-not-use-in-prod";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGoogleCalendarClient().getFreeBusy", () => {
  it("sends the expected request shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGoogleCalendarClient();
    const timeMin = new Date("2026-01-01T00:00:00.000Z");
    const timeMax = new Date("2026-01-02T00:00:00.000Z");
    await client.getFreeBusy(TOKEN, timeMin, timeMax);

    expect(fetchSpy).toHaveBeenCalledWith(
      FREEBUSY_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        }),
      }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    });
  });

  it("returns [] when the primary calendar has no busy field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: {} } }),
      }),
    );
    const client = createGoogleCalendarClient();
    const result = await client.getFreeBusy(TOKEN, new Date(), new Date());
    expect(result).toEqual([]);
  });

  it("returns [] when calendars is entirely absent from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
    );
    const client = createGoogleCalendarClient();
    const result = await client.getFreeBusy(TOKEN, new Date(), new Date());
    expect(result).toEqual([]);
  });

  it("returns parsed busy periods as Date objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          calendars: {
            primary: {
              busy: [{ start: "2026-01-01T10:00:00.000Z", end: "2026-01-01T11:00:00.000Z" }],
            },
          },
        }),
      }),
    );
    const client = createGoogleCalendarClient();
    const result = await client.getFreeBusy(TOKEN, new Date(), new Date());
    expect(result).toEqual([
      { start: new Date("2026-01-01T10:00:00.000Z"), end: new Date("2026-01-01T11:00:00.000Z") },
    ]);
  });

  it("throws GoogleCalendarApiError on a non-2xx response, including the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(/403/);
  });

  it("throws GoogleCalendarApiError when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when the response body is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null }));
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when the response body is a non-object primitive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => "unexpected" }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when calendar-level errors is present but not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: { errors: {} } } }),
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when calendar-level errors is a non-empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          calendars: { primary: { errors: [{ reason: "notFound" }] } },
        }),
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when busy is present but not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: { busy: "not-an-array" } } }),
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when a busy period is missing start/end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: { busy: [{ start: "2026-01-01T00:00:00.000Z" }] } } }),
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError when a busy period date is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          calendars: { primary: { busy: [{ start: "not-a-date", end: "also-not-a-date" }] } },
        }),
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.toThrow(
      GoogleCalendarApiError,
    );
  });

  it("throws GoogleCalendarApiError on a network failure, without leaking the access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = createGoogleCalendarClient();
    const result = client.getFreeBusy(TOKEN, new Date(), new Date());
    await expect(result).rejects.toBeInstanceOf(GoogleCalendarApiError);
    await expect(result).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it("does not leak the access token in a non-2xx error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const client = createGoogleCalendarClient();
    await expect(client.getFreeBusy(TOKEN, new Date(), new Date())).rejects.not.toThrow(
      new RegExp(TOKEN),
    );
  });
});

describe("createGoogleCalendarClient().createEvent", () => {
  const event = {
    startTime: new Date("2026-01-01T10:00:00.000Z"),
    endTime: new Date("2026-01-01T11:00:00.000Z"),
    summary: "Test appointment",
  };

  it("sends the expected request shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "event-123" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGoogleCalendarClient();
    await client.createEvent(TOKEN, event);

    expect(fetchSpy).toHaveBeenCalledWith(
      EVENTS_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        }),
      }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      summary: event.summary,
      start: { dateTime: event.startTime.toISOString() },
      end: { dateTime: event.endTime.toISOString() },
    });
  });

  it("returns the created event's id on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "event-123" }) }),
    );
    const client = createGoogleCalendarClient();
    const result = await client.createEvent(TOKEN, event);
    expect(result).toEqual({ eventId: "event-123" });
  });

  it("throws GoogleCalendarApiError on a non-2xx response, including the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    const client = createGoogleCalendarClient();
    await expect(client.createEvent(TOKEN, event)).rejects.toThrow(GoogleCalendarApiError);
    await expect(client.createEvent(TOKEN, event)).rejects.toThrow(/400/);
  });

  it("throws GoogleCalendarApiError when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const client = createGoogleCalendarClient();
    await expect(client.createEvent(TOKEN, event)).rejects.toThrow(GoogleCalendarApiError);
  });

  it("throws GoogleCalendarApiError when the response has no usable id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "" }) }));
    const client = createGoogleCalendarClient();
    await expect(client.createEvent(TOKEN, event)).rejects.toThrow(GoogleCalendarApiError);
  });

  it("throws GoogleCalendarApiError on a network failure, without leaking the access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = createGoogleCalendarClient();
    const result = client.createEvent(TOKEN, event);
    await expect(result).rejects.toBeInstanceOf(GoogleCalendarApiError);
    await expect(result).rejects.not.toThrow(new RegExp(TOKEN));
  });
});

describe("createGoogleCalendarClient().deleteEvent", () => {
  it("sends the expected request shape with no body and no Content-Type", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGoogleCalendarClient();
    await client.deleteEvent(TOKEN, "event-123");

    expect(fetchSpy).toHaveBeenCalledWith(`${EVENTS_URL}/event-123`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  it("URL-encodes the event id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGoogleCalendarClient();
    await client.deleteEvent(TOKEN, "event/with spaces");

    expect(fetchSpy).toHaveBeenCalledWith(
      `${EVENTS_URL}/${encodeURIComponent("event/with spaces")}`,
      expect.anything(),
    );
  });

  it("resolves without throwing on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) }));
    const client = createGoogleCalendarClient();
    await expect(client.deleteEvent(TOKEN, "event-123")).resolves.toBeUndefined();
  });

  it("throws GoogleCalendarApiError on a non-2xx response, including the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    const client = createGoogleCalendarClient();
    await expect(client.deleteEvent(TOKEN, "event-123")).rejects.toThrow(GoogleCalendarApiError);
    await expect(client.deleteEvent(TOKEN, "event-123")).rejects.toThrow(/404/);
  });

  it("throws GoogleCalendarApiError on a network failure, without leaking the access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = createGoogleCalendarClient();
    const result = client.deleteEvent(TOKEN, "event-123");
    await expect(result).rejects.toBeInstanceOf(GoogleCalendarApiError);
    await expect(result).rejects.not.toThrow(new RegExp(TOKEN));
  });
});
