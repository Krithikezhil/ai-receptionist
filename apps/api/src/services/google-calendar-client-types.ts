/**
 * Implementation-agnostic contract for the Google Calendar Data API
 * operations AppointmentService needs. This file defines the interface
 * only -- no implementation lives here. The real implementation (Step 6)
 * performs actual HTTPS calls to Google's Calendar API; the fake
 * implementation used in tests lives in
 * tests/support/fake-google-calendar-client.ts (a pure test double, never
 * production-selectable -- see the approved M10 Step 4 architecture for
 * why this differs from EmbeddingProvider's "fake" mode, which is a real
 * runtime option).
 *
 * Security boundary: every method takes ONLY a short-lived Google access
 * token, obtained by the caller from CalendarConnectionService.
 * getAccessToken(). This interface has no knowledge of refresh tokens,
 * encrypted ciphertext, the encryption key, OAuth client credentials, or
 * authorization codes -- none of that credential material can be
 * expressed through this contract at all, by construction.
 *
 * organizationId is deliberately absent from every method: this client is
 * a stateless Google API wrapper, not organization-aware. Tenant scoping
 * happens one layer up, in AppointmentService, which is the only thing
 * that knows which organization's access token it obtained.
 *
 * v1 scope: always operates on the connected account's PRIMARY calendar
 * (no calendar-id parameter, no picker) -- see the approved M10 plan.
 */

export interface GoogleCalendarBusyPeriod {
  start: Date;
  end: Date;
}

/**
 * Thrown by any method below on failure (network error, non-2xx response,
 * malformed response body, or any other operational failure). Never
 * constructed with response headers, request bodies, or any other value
 * that could carry the access token or other credential material --
 * callers (AppointmentService) must treat this as an opaque, generic
 * failure signal, mapping it to calendar_unavailable/booking_failed
 * without inspecting its message for detail.
 */
export class GoogleCalendarApiError extends Error {}

export interface GoogleCalendarClient {
  /**
   * Returns the busy periods on the connected primary calendar within
   * [timeMin, timeMax). Used by AppointmentService's availability
   * computation (one call per requested window, never per candidate slot)
   * and again, narrowly, immediately before booking to re-check the exact
   * requested window.
   */
  getFreeBusy(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarBusyPeriod[]>;

  /**
   * Creates an event on the connected primary calendar. Called only after
   * the corresponding local appointment row has already been committed
   * (see the approved booking-write ordering) -- this method itself has
   * no awareness of that ordering or of any compensating rollback; it
   * only ever performs the one create operation it's asked for.
   */
  createEvent(
    accessToken: string,
    event: { startTime: Date; endTime: Date; summary: string },
  ): Promise<{ eventId: string }>;

  /**
   * Deletes an event from the connected primary calendar -- used both for
   * the compensating rollback when local persistence fails after a
   * successful create, and for best-effort cleanup on appointment
   * cancellation. Callers are expected to treat failure here as
   * best-effort (catch and continue) in both of those cases; this method
   * itself makes no such judgment -- it simply attempts the delete and
   * throws GoogleCalendarApiError on failure like the other two methods.
   */
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
}
