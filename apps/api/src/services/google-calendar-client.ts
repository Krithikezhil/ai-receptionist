import type {
  GoogleCalendarBusyPeriod,
  GoogleCalendarClient,
} from "./google-calendar-client-types.js";
import { GoogleCalendarApiError } from "./google-calendar-client-types.js";

const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface GoogleFreeBusyResponse {
  calendars?: {
    primary?: {
      busy?: unknown;
      errors?: unknown;
    };
  };
}

function isGoogleFreeBusyResponse(body: unknown): body is GoogleFreeBusyResponse {
  return typeof body === "object" && body !== null;
}

interface GoogleEventResponse {
  id: string;
}

function isGoogleEventResponse(body: unknown): body is GoogleEventResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as GoogleEventResponse).id === "string" &&
    (body as GoogleEventResponse).id.length > 0
  );
}

/**
 * Real production GoogleCalendarClient -- native fetch only, no SDK. Every
 * method receives ONLY a short-lived access token (never a refresh token,
 * never OAuth client credentials -- see google-calendar-client-types.ts's
 * own security boundary comment). Always operates on the connected
 * account's "primary" calendar -- Google's own reserved calendar-id
 * string for this purpose, which is exactly how "primary only, no
 * picker, no calendarId parameter" is implemented: there is nothing to
 * look up or select. Stateless: this factory takes no arguments, since
 * nothing about it varies per call except the token/dates/event data
 * already passed into each method.
 */
export function createGoogleCalendarClient(): GoogleCalendarClient {
  return {
    async getFreeBusy(accessToken, timeMin, timeMax) {
      let response: Response;
      try {
        response = await fetch(FREEBUSY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            items: [{ id: "primary" }],
          }),
        });
      } catch {
        // Network/DNS/connection failure before any response existed --
        // accessToken is never included in this or any other branch below.
        throw new GoogleCalendarApiError("Google Calendar FreeBusy request failed.");
      }

      if (!response.ok) {
        throw new GoogleCalendarApiError(
          `Google Calendar FreeBusy request failed with status ${response.status}.`,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new GoogleCalendarApiError("Google Calendar FreeBusy response was not valid JSON.");
      }

      if (!isGoogleFreeBusyResponse(body)) {
        throw new GoogleCalendarApiError("Google Calendar FreeBusy response was malformed.");
      }

      const primary = body.calendars?.primary;

      // A calendar-level error (e.g. Google couldn't evaluate free/busy
      // for this calendar) must never be silently treated as "nothing
      // busy" -- that would be a correctness/safety failure, not just a
      // parsing nicety. A present-but-non-array `errors` value is itself
      // treated as malformed, not silently ignored. No error detail from
      // Google is included in either thrown message.
      const rawErrors = primary?.errors;
      if (rawErrors !== undefined) {
        if (!Array.isArray(rawErrors)) {
          throw new GoogleCalendarApiError("Google Calendar FreeBusy response was malformed.");
        }
        if (rawErrors.length > 0) {
          throw new GoogleCalendarApiError(
            "Google Calendar FreeBusy reported an error for the primary calendar.",
          );
        }
      }

      // Only once we know there was no calendar-level error does an
      // absent `busy` field mean "nothing busy".
      const rawBusy = primary?.busy;
      if (rawBusy === undefined) return [];
      if (!Array.isArray(rawBusy)) {
        throw new GoogleCalendarApiError("Google Calendar FreeBusy response was malformed.");
      }

      const periods: GoogleCalendarBusyPeriod[] = [];
      for (const period of rawBusy) {
        if (
          typeof period !== "object" ||
          period === null ||
          typeof (period as { start?: unknown }).start !== "string" ||
          typeof (period as { end?: unknown }).end !== "string"
        ) {
          // Fail closed on the whole response rather than silently
          // dropping one malformed entry -- partial/wrong availability
          // data is worse than an explicit failure here.
          throw new GoogleCalendarApiError("Google Calendar FreeBusy response was malformed.");
        }
        const { start, end } = period as { start: string; end: string };
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          throw new GoogleCalendarApiError(
            "Google Calendar FreeBusy response contained an invalid date.",
          );
        }
        periods.push({ start: startDate, end: endDate });
      }
      return periods;
    },

    async createEvent(accessToken, event) {
      let response: Response;
      try {
        response = await fetch(EVENTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            summary: event.summary,
            // toISOString() always includes an explicit "Z" UTC offset,
            // which Google accepts as a fully-qualified RFC3339 dateTime
            // on its own -- no separate timeZone field is needed since
            // startTime/endTime are already resolved absolute instants,
            // never a floating local time.
            start: { dateTime: event.startTime.toISOString() },
            end: { dateTime: event.endTime.toISOString() },
          }),
        });
      } catch {
        throw new GoogleCalendarApiError("Google Calendar event creation request failed.");
      }

      if (!response.ok) {
        throw new GoogleCalendarApiError(
          `Google Calendar event creation failed with status ${response.status}.`,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new GoogleCalendarApiError(
          "Google Calendar event creation response was not valid JSON.",
        );
      }

      if (!isGoogleEventResponse(body)) {
        throw new GoogleCalendarApiError("Google Calendar event creation response was malformed.");
      }

      return { eventId: body.id };
    },

    async deleteEvent(accessToken, eventId) {
      let response: Response;
      try {
        response = await fetch(`${EVENTS_URL}/${encodeURIComponent(eventId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw new GoogleCalendarApiError("Google Calendar event deletion request failed.");
      }

      if (!response.ok) {
        throw new GoogleCalendarApiError(
          `Google Calendar event deletion failed with status ${response.status}.`,
        );
      }
    },
  };
}
