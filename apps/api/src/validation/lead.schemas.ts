import { z } from "zod";

const leadStatus = z.enum(["new", "contacted", "closed"]);

/**
 * Internal-endpoint-only (services/voice-agent's capture_lead tool -- see
 * the approved M9 plan). Deliberately excludes `status`: a newly captured
 * lead is always "new" (the DB column's own default, see db/schema.ts),
 * never caller/voice-agent-settable -- status only ever changes via a
 * dashboard user's explicit updateLeadStatusSchema action below. Every
 * field is a capped freeform string (trim + max length), not stricter
 * format validation (e.g. no z.email() for contactEmail, no E.164 regex
 * for contactPhone, unlike businessProfileSchema/createPhoneNumberSchema
 * in organization.schemas.ts) -- this is transcribed, caller-stated
 * information, not a business's own curated data, so the goal is
 * capturing whatever was actually said rather than rejecting a lead over
 * a format quirk.
 */
export const createLeadSchema = z
  .object({
    contactName: z.string().trim().max(200).nullable().optional(),
    contactPhone: z.string().trim().max(50).nullable().optional(),
    contactEmail: z.string().trim().max(320).nullable().optional(),
    intent: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Informational only, not format-validated -- see db/schema.ts's own
    // comment on the leads.callSid column. Deliberately excluded from the
    // "at least one field" check below: a call id alone is not a lead.
    callSid: z.string().trim().max(100).nullable().optional(),
  })
  .refine(
    (lead) =>
      Boolean(lead.contactName) ||
      Boolean(lead.contactPhone) ||
      Boolean(lead.contactEmail) ||
      Boolean(lead.intent) ||
      Boolean(lead.notes),
    {
      message:
        "At least one of contactName, contactPhone, contactEmail, intent, or notes must be provided.",
    },
  );

/**
 * Dashboard-only -- the sole field a human is allowed to change on a
 * captured lead in M9's scope (no manual lead creation/editing beyond
 * status, per the approved M9 plan).
 */
export const updateLeadStatusSchema = z.object({
  status: leadStatus,
});

export const leadListQuerySchema = z.object({
  status: leadStatus.optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
