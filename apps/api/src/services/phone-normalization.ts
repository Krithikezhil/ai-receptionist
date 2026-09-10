/**
 * Dependency-free E.164 normalization for outbound SMS destinations
 * (M11 Step 4B). Mirrors organization.schemas.ts's createPhoneNumberSchema
 * regex exactly (services in this codebase don't import from the
 * validation layer -- see appointment.service.ts's own CLOCK_TIME_PATTERN
 * for the identical precedent of duplicating a small, stable regex rather
 * than reaching across that boundary).
 *
 * Deliberately narrow: strips ONLY cosmetic formatting characters
 * (whitespace, hyphens, parentheses, dots) that a human might type around
 * an otherwise-already-E.164 number -- never infers, guesses, or assumes
 * a country/region for a bare domestic-format number (e.g. "555-1234"
 * normalizes to nothing usable and is correctly rejected, not guessed
 * into a US number). A monorepo-wide dependency search confirmed no
 * existing phone-parsing library is available or would even help here:
 * general-purpose parsers (e.g. libphonenumber) still require a default-
 * region hint to interpret non-E.164 input, which this system has no
 * reliable source for and is explicitly forbidden from guessing.
 */

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const COSMETIC_CHARACTERS_PATTERN = /[\s\-().]/g;

/**
 * Returns the canonical E.164 form of `input`, or null if `input` is not
 * already unambiguously E.164 once purely cosmetic formatting characters
 * are removed. Callers (SmsNotificationService) must treat null as
 * fail-closed: no SMS notification is created for that destination.
 */
export function normalizeE164(input: string): string | null {
  const stripped = input.replace(COSMETIC_CHARACTERS_PATTERN, "");
  return E164_PATTERN.test(stripped) ? stripped : null;
}
