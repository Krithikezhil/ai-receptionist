import { describe, expect, it } from "vitest";
import { normalizeE164 } from "../src/services/phone-normalization.js";

describe("normalizeE164", () => {
  it("passes an already-valid E.164 number through unchanged", () => {
    expect(normalizeE164("+14155552671")).toBe("+14155552671");
  });

  it("strips spaces, parentheses, and a hyphen in one input", () => {
    expect(normalizeE164("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("strips a purely hyphen-separated number", () => {
    expect(normalizeE164("+1-415-555-2671")).toBe("+14155552671");
  });

  it("strips a purely dot-separated number", () => {
    expect(normalizeE164("+1.415.555.2671")).toBe("+14155552671");
  });

  it("strips a combination of all four cosmetic character types", () => {
    expect(normalizeE164("+1 (415)-555.2671")).toBe("+14155552671");
  });

  it("rejects a bare domestic number with no country code or leading +", () => {
    expect(normalizeE164("4155552671")).toBeNull();
  });

  it("rejects a short bare local number", () => {
    expect(normalizeE164("555-2671")).toBeNull();
  });

  it("rejects a number with digits matching a valid E.164 but missing the leading +", () => {
    expect(normalizeE164("14155552671")).toBeNull();
  });

  it("rejects a leading zero immediately after +", () => {
    expect(normalizeE164("+0123456789")).toBeNull();
  });

  it("rejects a value exceeding the E.164 maximum length (15 digits after +)", () => {
    expect(normalizeE164("+1234567890123456")).toBeNull();
  });

  it("rejects alphabetic/malformed input", () => {
    expect(normalizeE164("+1555ABC4567")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeE164("")).toBeNull();
  });

  it("never guesses a country/region for an unqualified domestic-style number, even one shaped like a plausible national number", () => {
    // "555-2671" and "4155552671" above already demonstrate this; this
    // case adds a longer domestic-shaped number to the same proof --
    // there is no country code anywhere in the input, so normalizeE164
    // must never infer one (e.g. assume a US "+1").
    expect(normalizeE164("(415) 555-2671")).toBeNull();
  });

  it("does not silently strip punctuation outside the approved cosmetic set", () => {
    // "/" is not whitespace, a hyphen, a parenthesis, or a dot -- it must
    // survive stripping and correctly cause rejection, proving the
    // implementation doesn't over-strip arbitrary punctuation.
    expect(normalizeE164("+1/415/555/2671")).toBeNull();
  });

  it("does not silently strip an underscore", () => {
    expect(normalizeE164("+1_415_555_2671")).toBeNull();
  });
});
