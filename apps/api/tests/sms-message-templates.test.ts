import { describe, expect, it } from "vitest";
import {
  formatAppointmentDateTime,
  renderAppointmentConfirmationBody,
  renderAppointmentReminderBody,
  renderLeadConfirmationBody,
} from "../src/services/sms-message-templates.js";

describe("formatAppointmentDateTime", () => {
  it("formats the approved exact style", () => {
    // "UTC" is used here specifically to isolate pure numeric
    // formatting from timezone resolution -- timezone handling itself
    // is covered separately below, relying on toLocalParts's own
    // already-established DST correctness rather than duplicating it.
    const instant = new Date("2030-01-07T10:00:00.000Z");
    expect(formatAppointmentDateTime(instant, "UTC")).toBe("January 7, 2030 at 10:00 AM");
  });

  it("formats a PM time", () => {
    const instant = new Date("2030-01-07T22:15:00.000Z");
    expect(formatAppointmentDateTime(instant, "UTC")).toBe("January 7, 2030 at 10:15 PM");
  });

  it("formats midnight as 12:00 AM", () => {
    const instant = new Date("2030-01-07T00:00:00.000Z");
    expect(formatAppointmentDateTime(instant, "UTC")).toBe("January 7, 2030 at 12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    const instant = new Date("2030-01-07T12:00:00.000Z");
    expect(formatAppointmentDateTime(instant, "UTC")).toBe("January 7, 2030 at 12:00 PM");
  });

  it("zero-pads single-digit minutes", () => {
    const instant = new Date("2030-01-07T10:05:00.000Z");
    expect(formatAppointmentDateTime(instant, "UTC")).toBe("January 7, 2030 at 10:05 AM");
  });

  it("respects a non-UTC IANA timezone, relying on toLocalParts's own resolution rather than duplicating it", () => {
    // 2030-01-07T03:00:00.000Z in America/New_York (EST, UTC-5 in
    // January) is 2030-01-06 10:00 PM local -- both the date and the
    // hour differ from the raw UTC representation, demonstrating the
    // supplied timezone is genuinely applied, not ignored or assumed
    // to be UTC/server-local.
    const instant = new Date("2030-01-07T03:00:00.000Z");
    expect(formatAppointmentDateTime(instant, "America/New_York")).toBe(
      "January 6, 2030 at 10:00 PM",
    );
  });

  it("reflects DST: the same UTC clock time renders a different local hour across seasons", () => {
    // Both instants are 15:00 UTC. January is EST (UTC-5); July is EDT
    // (UTC-4). This proves formatAppointmentDateTime correctly delegates
    // to toLocalParts's DST-aware resolution rather than applying a
    // fixed offset -- it does not reimplement or duplicate any DST rule
    // itself.
    const winterInstant = new Date("2030-01-15T15:00:00.000Z");
    const summerInstant = new Date("2030-07-15T15:00:00.000Z");
    expect(formatAppointmentDateTime(winterInstant, "America/New_York")).toBe(
      "January 15, 2030 at 10:00 AM",
    );
    expect(formatAppointmentDateTime(summerInstant, "America/New_York")).toBe(
      "July 15, 2030 at 11:00 AM",
    );
  });
});

describe("renderAppointmentConfirmationBody", () => {
  const startTime = new Date("2030-01-07T10:00:00.000Z");

  it("includes the supplied business name, explicit date/time wording, and the formatted schedule", () => {
    const body = renderAppointmentConfirmationBody("Acme Dental", startTime, "UTC");
    expect(body).toContain("Acme Dental");
    expect(body).toContain("January 7, 2030 at 10:00 AM");
    expect(body).toContain("confirmed for");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("never uses relative date wording", () => {
    const body = renderAppointmentConfirmationBody("Acme Dental", startTime, "UTC");
    expect(body.toLowerCase()).not.toContain("tomorrow");
    expect(body.toLowerCase()).not.toContain("today");
  });

  it("renders the date/time from startTime, not any other implicit value", () => {
    const otherStartTime = new Date("2031-06-15T18:30:00.000Z");
    const bodyA = renderAppointmentConfirmationBody("Acme Dental", startTime, "UTC");
    const bodyB = renderAppointmentConfirmationBody("Acme Dental", otherStartTime, "UTC");
    expect(bodyA).toContain("January 7, 2030 at 10:00 AM");
    expect(bodyB).toContain("June 15, 2031 at 6:30 PM");
    expect(bodyA).not.toBe(bodyB);
  });

  it("uses whichever business name/timezone the caller supplies -- no cached or hardcoded business data", () => {
    const bodyAcme = renderAppointmentConfirmationBody("Acme Dental", startTime, "UTC");
    const bodyOther = renderAppointmentConfirmationBody("Other Business", startTime, "UTC");
    expect(bodyAcme).toContain("Acme Dental");
    expect(bodyAcme).not.toContain("Other Business");
    expect(bodyOther).toContain("Other Business");
    expect(bodyOther).not.toContain("Acme Dental");
  });
});

describe("renderAppointmentReminderBody", () => {
  const startTime = new Date("2030-01-07T10:00:00.000Z");

  it("includes the supplied business name and explicit scheduled date/time", () => {
    const body = renderAppointmentReminderBody("Acme Dental", startTime, "UTC");
    expect(body).toContain("Acme Dental");
    expect(body).toContain("January 7, 2030 at 10:00 AM");
    expect(body).toContain("Reminder:");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("never uses relative date wording", () => {
    const body = renderAppointmentReminderBody("Acme Dental", startTime, "UTC");
    expect(body.toLowerCase()).not.toContain("tomorrow");
    expect(body.toLowerCase()).not.toContain("today");
  });

  it("respects the supplied timezone the same way the confirmation does", () => {
    const instant = new Date("2030-01-07T03:00:00.000Z");
    const body = renderAppointmentReminderBody("Acme Dental", instant, "America/New_York");
    expect(body).toContain("January 6, 2030 at 10:00 PM");
  });
});

describe("renderLeadConfirmationBody", () => {
  it("includes the supplied business name and the STOP opt-out instruction, with no appointment data required", () => {
    const body = renderLeadConfirmationBody("Acme Dental");
    expect(body).toContain("Acme Dental");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("uses whichever business name the caller supplies", () => {
    const bodyAcme = renderLeadConfirmationBody("Acme Dental");
    const bodyOther = renderLeadConfirmationBody("Other Business");
    expect(bodyAcme).toContain("Acme Dental");
    expect(bodyOther).toContain("Other Business");
    expect(bodyAcme).not.toBe(bodyOther);
  });
});
