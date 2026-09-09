import { IANAZone } from "luxon";

/**
 * Pure, deterministic timezone/date-time helper for M10. No database
 * access, no HTTP/Google calls, no logging, no environment-variable
 * reads -- every input is an explicit parameter, every output is a plain
 * value. AppointmentService (a later file) is responsible for combining
 * these results with repository/Google-FreeBusy data; this file never
 * does that itself.
 *
 * All interval semantics in this file are half-open: [start, end).
 *
 * Uses Luxon's IANAZone purely as the source of authoritative IANA
 * offset data (via Zone#offset) -- no DST rule table is hand-maintained
 * here. What Luxon's own DateTime.fromObject/isValid do NOT provide is
 * detection of nonexistent (spring-forward gap) or ambiguous (fall-back
 * overlap) local times -- empirically verified against the installed
 * Luxon 3.7.2: DateTime.fromObject silently shifts a nonexistent local
 * time forward and silently picks one offset for an ambiguous one,
 * reporting isValid: true either way. The detection algorithm below is
 * built on top of Zone#offset specifically to catch both cases
 * explicitly, verified against real 2026 America/New_York transition
 * dates before being written here.
 */

export type ResolveAppointmentTimeResult =
  | { status: "ok"; startTime: Date }
  | { status: "invalid_timezone" }
  | { status: "invalid_time" }
  | { status: "nonexistent_time" }
  | { status: "ambiguous_time" }
  | { status: "past_time" };

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0=Sunday..6=Saturday, matching business_hours.dayOfWeek's convention. */
  dayOfWeek: number;
}

export interface BusinessHoursInterval {
  /** "HH:MM", inclusive open boundary. */
  openTime: string;
  /** "HH:MM", exclusive close boundary. */
  closeTime: string;
}

const SLOT_GRANULARITY_MINUTES = 15;
const BRACKET_MS = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** Validates a string as a real IANA timezone identifier (not merely a
 * plausible-looking specifier -- see IANAZone.isValidZone's own docs). */
export function isValidIanaTimezone(timezone: string): boolean {
  return IANAZone.isValidZone(timezone);
}

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

/** Rejects impossible calendar dates (e.g. 2026-02-30) that DATE_PATTERN's
 * shape check alone would accept -- Date.UTC silently normalizes them, so
 * the constructed date is compared back against the input to detect that. */
function parseCalendarDate(date: string): ParsedDate | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Returns the day-of-week (0=Sunday..6=Saturday, matching
 * business_hours.dayOfWeek) for a calendar date, or null if the date
 * string is not a real calendar date. Day-of-week for a Y-M-D triple is
 * timezone-independent -- no IANA zone or DST resolution is needed here,
 * unlike resolveAppointmentStartTime. */
export function dayOfWeekForCalendarDate(date: string): number | null {
  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

interface ParsedTime {
  hour: number;
  minute: number;
}

function parseClockTime(time: string): ParsedTime | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  const hour = Number(match[1]!);
  const minute = Number(match[2]!);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

type LocalInstantClassification =
  | { kind: "ok"; instantMs: number }
  | { kind: "nonexistent" }
  | { kind: "ambiguous" };

/**
 * Resolves one local wall-clock reading (year/month/day/hour/minute) in
 * `zone` to a UTC instant, explicitly detecting the nonexistent
 * (spring-forward gap) and ambiguous (fall-back overlap) cases rather
 * than trusting Luxon's own single-answer resolution. See this file's
 * header comment and the empirical verification that produced this
 * specific technique.
 */
function classifyLocalInstant(
  zone: IANAZone,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalInstantClassification {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const offsetPrev = zone.offset(naiveUtcMs - BRACKET_MS);
  const offsetNext = zone.offset(naiveUtcMs + BRACKET_MS);

  function tryOffset(offsetMinutes: number): { candidate: number; matches: boolean } {
    const candidate = naiveUtcMs - offsetMinutes * 60_000;
    const actualOffset = zone.offset(candidate);
    const local = new Date(candidate + actualOffset * 60_000);
    const matches =
      local.getUTCFullYear() === year &&
      local.getUTCMonth() === month - 1 &&
      local.getUTCDate() === day &&
      local.getUTCHours() === hour &&
      local.getUTCMinutes() === minute;
    return { candidate, matches };
  }

  const early = tryOffset(offsetPrev);
  const late = tryOffset(offsetNext);

  const distinctCandidates = [early, late].filter(
    (c, i, arr) => arr.findIndex((x) => x.candidate === c.candidate) === i,
  );
  const matching = distinctCandidates.filter((c) => c.matches).map((c) => c.candidate);

  if (matching.length === 0) return { kind: "nonexistent" };
  if (matching.length >= 2) return { kind: "ambiguous" };
  return { kind: "ok", instantMs: matching[0]! };
}

/**
 * Resolves a caller-supplied local `date` ("YYYY-MM-DD") + `time`
 * ("HH:MM") in the organization's IANA `timezone` to a UTC instant.
 * Never accepts a client/LLM-supplied UTC timestamp or offset -- the
 * caller supplies only natural local values and the already-validated
 * timezone; this function does the resolution. `now` is an injectable
 * parameter (defaulting to the real current time) so past-time rejection
 * is deterministically testable.
 */
export function resolveAppointmentStartTime(
  timezone: string,
  date: string,
  time: string,
  now: Date = new Date(),
): ResolveAppointmentTimeResult {
  if (!isValidIanaTimezone(timezone)) return { status: "invalid_timezone" };

  const parsedDate = parseCalendarDate(date);
  if (!parsedDate) return { status: "invalid_time" };

  const parsedTime = parseClockTime(time);
  if (!parsedTime) return { status: "invalid_time" };

  const zone = IANAZone.create(timezone);
  if (!zone.isValid) return { status: "invalid_timezone" };

  const classification = classifyLocalInstant(
    zone,
    parsedDate.year,
    parsedDate.month,
    parsedDate.day,
    parsedTime.hour,
    parsedTime.minute,
  );

  if (classification.kind === "nonexistent") return { status: "nonexistent_time" };
  if (classification.kind === "ambiguous") return { status: "ambiguous_time" };

  const startTime = new Date(classification.instantMs);
  if (startTime.getTime() < now.getTime()) return { status: "past_time" };

  return { status: "ok", startTime };
}

/**
 * Converts an already-resolved UTC instant into its local representation
 * in `timezone` -- used for business-hours comparisons (which day-of-week
 * and which local clock time this instant falls on locally, not in UTC).
 * Unlike local-to-UTC resolution, UTC-to-local conversion is always
 * well-defined -- there is no gap/ambiguity concept in this direction.
 * Fails closed: throws RangeError for an invalid IANA timezone rather
 * than returning values derived from it.
 */
export function toLocalParts(instant: Date, timezone: string): LocalDateTimeParts {
  if (!IANAZone.isValidZone(timezone)) {
    throw new RangeError(`Not a valid IANA timezone: ${timezone}`);
  }
  const zone = IANAZone.create(timezone);
  const offsetMinutes = zone.offset(instant.getTime());
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    dayOfWeek: local.getUTCDay(),
  };
}

/** Strictly validates an "HH:MM" string -- shape AND range (hour 0-23,
 * minute 0-59) -- throwing RangeError for anything else, including
 * out-of-range values like "24:00" or "99:99" that the shape alone would
 * not catch. */
function clockTimeToMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Expected an "HH:MM" time string, got: ${value}`);
  }
  const hour = Number(match[1]!);
  const minute = Number(match[2]!);
  if (hour > 23 || minute > 59) {
    throw new RangeError(`Expected an "HH:MM" time string, got: ${value}`);
  }
  return hour * 60 + minute;
}

function validateDurationMinutes(durationMinutes: number): void {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError(
      `durationMinutes must be a finite positive number, got: ${durationMinutes}`,
    );
  }
}

/** Parses and validates a business-hours interval: both boundaries must be
 * valid "HH:MM" clock times, and closeTime must be strictly after
 * openTime. Overnight intervals (closeTime <= openTime) are rejected --
 * M10's business-hours model is not being expanded to support them here. */
function parseBusinessHoursInterval(interval: BusinessHoursInterval): {
  openMinutes: number;
  closeMinutes: number;
} {
  const openMinutes = clockTimeToMinutes(interval.openTime);
  const closeMinutes = clockTimeToMinutes(interval.closeTime);
  if (closeMinutes <= openMinutes) {
    throw new RangeError(
      `Invalid or empty business-hours interval: openTime=${interval.openTime}, ` +
        `closeTime=${interval.closeTime} (closeTime must be after openTime; overnight ` +
        "intervals are not supported).",
    );
  }
  return { openMinutes, closeMinutes };
}

/**
 * Generates every 15-minute-aligned local start time (as "HH:MM") within
 * `interval` such that a service of `durationMinutes` starting there
 * would end at or before interval.closeTime -- i.e. the entire service
 * duration fits inside the interval. Candidates snap to absolute
 * clock-aligned quarter-hours (:00/:15/:30/:45), not to openTime's own
 * offset. Returns an empty array if no candidate fits (including when
 * durationMinutes alone exceeds the interval's length).
 */
export function generateCandidateStartTimes(
  interval: BusinessHoursInterval,
  durationMinutes: number,
): string[] {
  validateDurationMinutes(durationMinutes);
  const { openMinutes, closeMinutes } = parseBusinessHoursInterval(interval);
  const firstSlot = Math.ceil(openMinutes / SLOT_GRANULARITY_MINUTES) * SLOT_GRANULARITY_MINUTES;

  const candidates: string[] = [];
  for (let start = firstSlot; start + durationMinutes <= closeMinutes; start += SLOT_GRANULARITY_MINUTES) {
    const hh = String(Math.floor(start / 60)).padStart(2, "0");
    const mm = String(start % 60).padStart(2, "0");
    candidates.push(`${hh}:${mm}`);
  }
  return candidates;
}

/**
 * True only if the entire [startTime, startTime + durationMinutes)
 * window fits within [interval.openTime, interval.closeTime).
 */
export function fitsWithinBusinessHours(
  startTime: string,
  durationMinutes: number,
  interval: BusinessHoursInterval,
): boolean {
  validateDurationMinutes(durationMinutes);
  const { openMinutes, closeMinutes } = parseBusinessHoursInterval(interval);
  const startMinutes = clockTimeToMinutes(startTime);
  return startMinutes >= openMinutes && startMinutes + durationMinutes <= closeMinutes;
}
