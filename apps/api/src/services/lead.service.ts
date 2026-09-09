import type {
  Lead,
  LeadRepository,
  LeadStatusUpdate,
  NewLead,
} from "../repositories/lead-types.js";
import type { SmsNotificationService } from "./sms-notification.service.js";

export interface LeadService {
  listLeads(organizationId: string): Promise<Lead[]>;
  /**
   * organizationId is a trusted parameter (the caller's own already-
   * authenticated route/service context), never taken from `input` --
   * `input`'s type omits both organizationId and status, so neither can be
   * smuggled through the request body even by a future caller that forgets
   * to strip them. A newly created lead is always "new" (the repository/DB
   * default) -- status is never caller-settable at creation.
   */
  createLead(organizationId: string, input: Omit<NewLead, "organizationId" | "status">): Promise<Lead>;
  /** undefined means "not found for this organization" -- identical whether the id doesn't exist at all or belongs to a different organization. */
  updateLeadStatus(
    organizationId: string,
    leadId: string,
    changes: LeadStatusUpdate,
  ): Promise<Lead | undefined>;
  deleteLead(organizationId: string, leadId: string): Promise<boolean>;
}

/**
 * Thrown when createLead's input has none of contactName/contactPhone/
 * contactEmail/intent/notes -- the same "not completely empty" invariant
 * createLeadSchema's own .refine() enforces at the controller boundary
 * (see validation/lead.schemas.ts). Re-checked here, independently, as a
 * defense-in-depth guarantee for this service's own contract: unlike every
 * other service in this codebase, LeadService has no controller yet
 * (M9 Step 5), so this is currently its only enforcement of that rule.
 * This service deliberately never imports zod/lead.schemas.ts itself --
 * matching every other service in this codebase, validation stays a
 * controller-boundary concern; this is a plain domain-invariant check, not
 * a duplicate schema call.
 */
export class EmptyLeadError extends Error {}

export function createLeadService(
  repo: LeadRepository,
  smsNotificationService: SmsNotificationService,
): LeadService {
  return {
    async listLeads(organizationId) {
      return repo.listByOrganizationId(organizationId);
    },

    async createLead(organizationId, input) {
      const hasContent =
        Boolean(input.contactName) ||
        Boolean(input.contactPhone) ||
        Boolean(input.contactEmail) ||
        Boolean(input.intent) ||
        Boolean(input.notes);
      if (!hasContent) {
        throw new EmptyLeadError(
          "A lead must include at least one of contactName, contactPhone, contactEmail, intent, or notes.",
        );
      }

      // callSid, if present, passes through unchanged -- informational
      // only, not a foreign key, not validated against any calls table
      // (none exists -- see db/schema.ts's own comment on leads.callSid).
      const lead = await repo.create({ ...input, organizationId });

      // M11 Step 3: fire-and-forget-safe -- scheduleLeadConfirmation never
      // throws (SmsNotificationService absorbs all failures internally,
      // including logging any unexpected one), so awaiting it here cannot
      // turn this already-successful lead creation into a failure.
      await smsNotificationService.scheduleLeadConfirmation(lead);

      return lead;
    },

    async updateLeadStatus(organizationId, leadId, changes) {
      return repo.updateStatus(leadId, organizationId, changes);
    },

    async deleteLead(organizationId, leadId) {
      return repo.deleteByIdAndOrganizationId(leadId, organizationId);
    },
  };
}
