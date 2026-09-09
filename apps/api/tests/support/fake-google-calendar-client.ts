import type {
  GoogleCalendarBusyPeriod,
  GoogleCalendarClient,
} from "../../src/services/google-calendar-client-types.js";
import { GoogleCalendarApiError } from "../../src/services/google-calendar-client-types.js";

/**
 * One recorded call, in order. accessToken itself is NEVER recorded --
 * only whether a truthy value was supplied -- so test assertions on call
 * history can never accidentally depend on or expose a token value.
 */
export type FakeGoogleCalendarClientCall =
  | { method: "getFreeBusy"; accessTokenProvided: boolean; timeMin: Date; timeMax: Date }
  | {
      method: "createEvent";
      accessTokenProvided: boolean;
      startTime: Date;
      endTime: Date;
      summary: string;
    }
  | { method: "deleteEvent"; accessTokenProvided: boolean; eventId: string };

/**
 * Test-only double for GoogleCalendarClient. Implements the interface
 * exactly, with mutable public fields a test can set before or between
 * calls to deterministically control every outcome (busy periods,
 * success/failure of each method, the returned event id). Never imported
 * by production code -- there is no production "fake mode" for Google
 * Calendar, unlike EmbeddingProvider's runtime-selectable "fake" (see the
 * approved M10 Step 4 architecture for why that distinction matters).
 *
 * Deliberately out of scope, per the approved M10 plan: no OAuth, no
 * refresh-token handling, no encryption, no real HTTP, no Google SDK, no
 * database access, no organizationId, no calendar selection, no
 * AppointmentService logic -- this is a pure, narrow double for exactly
 * the three GoogleCalendarClient methods.
 */
export interface FakeGoogleCalendarClient extends GoogleCalendarClient {
  /** Every call made so far, in order. */
  calls: FakeGoogleCalendarClientCall[];

  /** Busy periods getFreeBusy returns while failFreeBusy is false.
   * Reassign between steps within one test to simulate the calendar's
   * state changing (e.g. between an availability check and the
   * immediate pre-booking re-check). */
  busyPeriods: GoogleCalendarBusyPeriod[];

  /** When true, getFreeBusy throws GoogleCalendarApiError instead of
   * returning busyPeriods. */
  failFreeBusy: boolean;

  /** When true, createEvent throws GoogleCalendarApiError instead of
   * succeeding. */
  failCreateEvent: boolean;

  /** The eventId createEvent returns on success. Defaults to a
   * deterministic, incrementing id ("fake-event-1", "fake-event-2", ...)
   * so multiple bookings in one test are distinguishable without the
   * test supplying its own id. Once set, stays fixed for every
   * subsequent successful call until changed again (not a one-shot
   * value). */
  nextEventId: string | undefined;

  /** When true, deleteEvent throws GoogleCalendarApiError instead of
   * succeeding. */
  failDeleteEvent: boolean;

  /** eventIds passed to every successful deleteEvent call, in order --
   * lets a compensation test assert exactly which event was cleaned up
   * (e.g. that it matches the id createEvent returned). */
  deletedEventIds: string[];
}

export function createFakeGoogleCalendarClient(): FakeGoogleCalendarClient {
  let eventCounter = 0;

  const fake: FakeGoogleCalendarClient = {
    calls: [],
    busyPeriods: [],
    failFreeBusy: false,
    failCreateEvent: false,
    nextEventId: undefined,
    failDeleteEvent: false,
    deletedEventIds: [],

    async getFreeBusy(accessToken, timeMin, timeMax) {
      fake.calls.push({
        method: "getFreeBusy",
        accessTokenProvided: Boolean(accessToken),
        timeMin,
        timeMax,
      });
      if (fake.failFreeBusy) {
        throw new GoogleCalendarApiError("Fake Google Calendar: getFreeBusy configured to fail.");
      }
      return fake.busyPeriods;
    },

    async createEvent(accessToken, event) {
      fake.calls.push({
        method: "createEvent",
        accessTokenProvided: Boolean(accessToken),
        startTime: event.startTime,
        endTime: event.endTime,
        summary: event.summary,
      });
      if (fake.failCreateEvent) {
        throw new GoogleCalendarApiError("Fake Google Calendar: createEvent configured to fail.");
      }
      eventCounter += 1;
      const eventId = fake.nextEventId ?? `fake-event-${eventCounter}`;
      return { eventId };
    },

    async deleteEvent(accessToken, eventId) {
      fake.calls.push({
        method: "deleteEvent",
        accessTokenProvided: Boolean(accessToken),
        eventId,
      });
      if (fake.failDeleteEvent) {
        throw new GoogleCalendarApiError("Fake Google Calendar: deleteEvent configured to fail.");
      }
      fake.deletedEventIds.push(eventId);
    },
  };

  return fake;
}
