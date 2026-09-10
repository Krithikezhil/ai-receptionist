/**
 * M11 Step 4: pure, dependency-free classifier for inbound SMS keyword
 * text. Deliberately independent of Twilio's own OptOutType webhook
 * field -- confirmed (per the approved Twilio research) that OptOutType
 * is gated behind Advanced Opt-Out, a Messaging-Service-scoped feature
 * this application does not use (the worker sends directly via `From`,
 * never a Messaging Service SID) -- so this classifier is the sole,
 * authoritative source of truth for inbound keyword state changes,
 * whether or not OptOutType happens to also be present on a given
 * request.
 *
 * Matching is deliberately narrow: trimmed, case-insensitive, EXACT
 * match only -- never substring matching, never stripped punctuation.
 * "STOP PLEASE" and "PLEASE STOP" are correctly classified as unknown,
 * not opt-out, matching Twilio's own documented keyword-matching
 * behavior (an exact reply, not a phrase merely containing the keyword).
 */
export type InboundSmsClassification = "opt_out" | "opt_in" | "help" | "unknown";

/** All 8 keywords Twilio itself documents as default, always-on
 * opt-out keywords (independent of Advanced Opt-Out) for long-code
 * numbers, per the approved Twilio research. */
const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "END",
  "QUIT",
  "STOPALL",
  "REVOKE",
  "OPTOUT",
  "CANCEL",
]);

/** START and UNSTOP only -- YES is deliberately excluded. Twilio's own
 * documentation confirms YES does not reliably opt a previously
 * unsubscribed Toll-Free US number back in, and the approved
 * architecture does not require it. */
const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP"]);

const HELP_KEYWORDS = new Set(["HELP"]);

export function classifyInboundSmsBody(body: string): InboundSmsClassification {
  const normalized = body.trim().toUpperCase();
  if (OPT_OUT_KEYWORDS.has(normalized)) return "opt_out";
  if (OPT_IN_KEYWORDS.has(normalized)) return "opt_in";
  if (HELP_KEYWORDS.has(normalized)) return "help";
  return "unknown";
}
