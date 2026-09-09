import type {
  CalendarConnectionService,
  GetAccessTokenResult,
} from "../../src/services/calendar-connection.service.js";

/**
 * Test-only double for CalendarConnectionService. Implements the interface
 * exactly, with one mutable public field (getAccessTokenResult) a test sets
 * before a request to deterministically control bookAppointment()'s
 * calendar-connectivity outcome -- no network call, no token
 * encryption/decryption, no dependency on organizationCalendarConnections.
 * Mirrors fake-google-calendar-client.ts's style: a mutable field for
 * deterministic control plus a calls log for "assert what was called"
 * assertions. Never imported by production code -- there is no production
 * "fake mode" for calendar connections, matching FakeGoogleCalendarClient's
 * own precedent.
 *
 * Used only as the CalendarConnectionService AppointmentService receives in
 * build-test-app.ts -- the public router's own calendarConnectionService
 * (OAuth connect/callback routes) stays wired to the real
 * createCalendarConnectionService, unchanged, so oauth-flow.test.ts's
 * existing coverage of that real encrypt/decrypt/network-exchange logic is
 * unaffected.
 *
 * Deliberately out of scope: no OAuth, no refresh-token handling, no
 * encryption, no real HTTP, no database access -- this is a pure, narrow
 * double for exactly the five CalendarConnectionService methods, only one
 * of which (getAccessToken) needs real behavior for the M11 Step 3
 * appointment-confirmation tests it exists to support.
 */
export interface FakeCalendarConnectionService extends CalendarConnectionService {
  /** The result getAccessToken returns for every organizationId, until
   * reassigned. Defaults to {status: "not_connected"} -- the same
   * fail-closed default the real service has when no connection row
   * exists -- so a test must explicitly opt in to "connected". */
  getAccessTokenResult: GetAccessTokenResult;

  /** organizationId passed to every getAccessToken call, in order. */
  getAccessTokenCalls: string[];
}

export function createFakeCalendarConnectionService(): FakeCalendarConnectionService {
  const fake: FakeCalendarConnectionService = {
    getAccessTokenResult: { status: "not_connected" },
    getAccessTokenCalls: [],

    async getStatus(_organizationId) {
      if (fake.getAccessTokenResult.status !== "ok") return undefined;
      return { connected: true };
    },

    async completeOAuthConnection(_organizationId, _authorizationCode, _redirectUri) {
      return { status: "ok" };
    },

    async getAccessToken(organizationId) {
      fake.getAccessTokenCalls.push(organizationId);
      return fake.getAccessTokenResult;
    },

    async markNeedsReauthorization(_organizationId) {
      fake.getAccessTokenResult = { status: "needs_reauthorization" };
    },

    async disconnect(_organizationId) {
      fake.getAccessTokenResult = { status: "not_connected" };
      return true;
    },
  };

  return fake;
}
