import type {
  SendSmsInput,
  SendSmsResult,
  TwilioSmsClient,
} from "../../src/services/twilio-sms-client-types.js";
import { TwilioSmsApiError } from "../../src/services/twilio-sms-client-types.js";

/**
 * Test-only double for TwilioSmsClient. Mirrors fake-google-calendar-client.ts's
 * established style exactly: mutable public fields a test reassigns between
 * awaited steps to deterministically control each call's outcome, plus a
 * calls log for "assert what was sent" assertions. Never imported by
 * production code -- there is no production "fake mode" for Twilio.
 *
 * `to`/`body` ARE recorded in calls (unlike FakeGoogleCalendarClient's
 * accessToken, which is deliberately reduced to a boolean) because the
 * destination phone number and rendered message body are exactly what the
 * worker's tests need to assert against -- there is no secret in either
 * field the way there is in an OAuth access token. No production behavior
 * lives here -- sendSms() only ever returns whatever the test configured
 * or throws whatever the test configured; it never guesses, defaults to a
 * "plausible" success on its own, or otherwise conceals a worker bug.
 */
export interface FakeTwilioSmsClient extends TwilioSmsClient {
  /** Every call made so far, in order. */
  calls: SendSmsInput[];

  /** The result sendSms() returns while nextError is undefined. Defaults
   * to a deterministic, incrementing sid ("fake-sid-1", "fake-sid-2", ...)
   * with status "queued" (Twilio's real synchronous response never
   * reports "sent"/"delivered" -- see SendSmsResult's own doc comment) so
   * multiple sends in one test are distinguishable without the test
   * supplying its own sid. Reassign between awaited steps within one test
   * to change a later call's outcome -- not a one-shot value or a queue. */
  nextResult: SendSmsResult | undefined;

  /** When set, sendSms() throws this instead of returning nextResult --
   * takes priority over nextResult when both are set. Reassign (including
   * to `undefined`) between steps to simulate a later call failing
   * differently or succeeding (e.g. attempt 1 -> network error, attempt 2
   * -> success). */
  nextError: TwilioSmsApiError | undefined;
}

export function createFakeTwilioSmsClient(): FakeTwilioSmsClient {
  let sidCounter = 0;

  const fake: FakeTwilioSmsClient = {
    calls: [],
    nextResult: undefined,
    nextError: undefined,

    async sendSms(input) {
      fake.calls.push(input);
      if (fake.nextError) throw fake.nextError;
      sidCounter += 1;
      return fake.nextResult ?? { sid: `fake-sid-${sidCounter}`, status: "queued" };
    },
  };

  return fake;
}
