import { toLocalParts } from "./appointment-time.js";

/**
 * M11 Step 4B: pure SMS message body rendering -- no I/O, no repository
 * access, no Twilio, no database. Callers (the future worker) are
 * responsible for resolving the current BusinessProfile/Appointment data
 * and passing only the plain values these functions need; nothing here
 * is denormalized into sms_notifications (see the approved M11 Step 4B
 * design's explicit "do not denormalize" requirement) -- every render
 * call uses whatever CURRENT data the caller just looked up.
 *
 * Date/time formatting reuses toLocalParts(instant, timezone)
 * (appointment-time.ts) for all timezone/DST resolution -- this module
 * does no timezone or DST math of its own, only pretty-prints the
 * already-resolved local numeric parts. No new date/time library is
 * introduced.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Formats a resolved local instant as "January 7, 2030 at 10:00 AM" --
 * the one explicit date/time style approved for M11 Step 4B SMS
 * messages. Deliberately never produces relative wording ("tomorrow",
 * "today") -- the appointment's actual scheduled date/time is always
 * spelled out in full.
 */
export function formatAppointmentDateTime(startTime: Date, timezone: string): string {
  const parts = toLocalParts(startTime, timezone);
  const monthName = MONTH_NAMES[parts.month - 1];
  const hour12 = ((parts.hour + 11) % 12) + 1;
  const meridiem = parts.hour < 12 ? "AM" : "PM";
  const minute = String(parts.minute).padStart(2, "0");
  return `${monthName} ${parts.day}, ${parts.year} at ${hour12}:${minute} ${meridiem}`;
}

/**
 * Renders the appointment-confirmation SMS body. businessName/timezone
 * must come from the CURRENT BusinessProfile at send time (never cached
 * from booking time); startTime is the appointment's scheduled start
 * (never its createdAt).
 */
export function renderAppointmentConfirmationBody(
  businessName: string,
  startTime: Date,
  timezone: string,
): string {
  return (
    `Your appointment with ${businessName} is confirmed for ` +
    `${formatAppointmentDateTime(startTime, timezone)}. Reply STOP to opt out.`
  );
}

/**
 * Renders the appointment-reminder SMS body. Uses the same explicit
 * date/time format as the confirmation -- no relative wording such as
 * "tomorrow", per the approved M11 Step 4B design.
 */
export function renderAppointmentReminderBody(
  businessName: string,
  startTime: Date,
  timezone: string,
): string {
  return (
    `Reminder: your appointment with ${businessName} is ` +
    `${formatAppointmentDateTime(startTime, timezone)}. Reply STOP to opt out.`
  );
}

/**
 * Renders the lead-confirmation SMS body. Requires only the CURRENT
 * business name -- no appointment-specific data.
 */
export function renderLeadConfirmationBody(businessName: string): string {
  return (
    `Thanks for contacting ${businessName}. We've received your request ` +
    `and will be in touch soon. Reply STOP to opt out.`
  );
}
