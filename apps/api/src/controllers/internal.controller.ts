import type { RuntimeContext, RuntimeKnowledgeEntry } from "@ai-receptionist/shared";
import type { Request, Response } from "express";
import { generateCallCredential } from "../auth/call-credential.js";
import type { OrganizationPhoneNumberRepository } from "../repositories/organization-phone-number-types.js";
import type { BusinessHoursService } from "../services/business-hours.service.js";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import type { KnowledgeService } from "../services/knowledge.service.js";
import type { OrganizationService } from "../services/organization.service.js";
import type { ReceptionistConfigService } from "../services/receptionist-config.service.js";
import type { ServicesCatalogService } from "../services/services-catalog.service.js";
import { knowledgeListQuerySchema } from "../validation/knowledge.schemas.js";

export interface InternalControllerDeps {
  organizationService: OrganizationService;
  businessProfileService: BusinessProfileService;
  businessHoursService: BusinessHoursService;
  servicesCatalogService: ServicesCatalogService;
  knowledgeService: KnowledgeService;
  receptionistConfigService: ReceptionistConfigService;
  organizationPhoneNumbers: OrganizationPhoneNumberRepository;
  twilioCallCredentialSecret: string;
}

/**
 * Handlers for /internal/v1/* — reuses the exact same M2-M4 services the
 * user-facing /organizations/* routes use (no new repository/business
 * logic). The only things that differ from the public API are the auth
 * mechanism (requireServiceAuth, mounted in routes/internal.routes.ts, not
 * requireAuth/requireOrgMembership) and the aggregated response shape. See
 * ARCHITECTURE.md "Internal voice API".
 */
export function createInternalController(deps: InternalControllerDeps) {
  return {
    async getRuntimeContext(req: Request, res: Response): Promise<void> {
      const organizationId = req.params.organizationId as string;

      // No membership concept applies to a service credential — this is the
      // service-auth equivalent of requireOrgMembership's 404-for-unknown-org,
      // just without a user to check membership for.
      const organization = await deps.organizationService.getOrganization(organizationId);
      if (!organization) {
        res.status(404).json({ error: "Organization not found." });
        return;
      }

      const [receptionistConfig, businessProfile, businessHours, services] = await Promise.all([
        deps.receptionistConfigService.getReceptionistConfig(organizationId),
        deps.businessProfileService.getBusinessProfile(organizationId),
        deps.businessHoursService.getBusinessHours(organizationId),
        deps.servicesCatalogService.listServices(organizationId),
      ]);

      if (!receptionistConfig) {
        // Every organization gets one at creation time
        // (organization.service.ts) — this should be unreachable. Fail
        // loudly rather than hand the voice-agent a fabricated default it
        // would silently trust (e.g. "enabled: false" that isn't real).
        res.status(500).json({ error: "Receptionist configuration missing." });
        return;
      }

      const runtimeContext: RuntimeContext = {
        organizationId,
        receptionistConfig: {
          enabled: receptionistConfig.enabled,
          displayName: receptionistConfig.displayName,
          greeting: receptionistConfig.greeting,
          tone: receptionistConfig.tone,
          instructions: receptionistConfig.instructions,
          fallbackMessage: receptionistConfig.fallbackMessage,
          afterHoursMessage: receptionistConfig.afterHoursMessage,
          callTransferEnabled: receptionistConfig.callTransferEnabled,
          callTransferPhone: receptionistConfig.callTransferPhone,
          language: receptionistConfig.language,
        },
        businessProfile: businessProfile
          ? {
              businessName: businessProfile.businessName,
              description: businessProfile.description,
              phone: businessProfile.phone,
              email: businessProfile.email,
              website: businessProfile.website,
              address: businessProfile.address,
              timezone: businessProfile.timezone,
            }
          : null,
        businessHours: businessHours.map((h) => ({
          dayOfWeek: h.dayOfWeek,
          isOpen: h.isOpen,
          openTime: h.openTime,
          closeTime: h.closeTime,
        })),
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          price: s.price,
          active: s.active,
        })),
      };

      res.status(200).json({ runtimeContext });
    },

    async listKnowledge(req: Request, res: Response): Promise<void> {
      const organizationId = req.params.organizationId as string;

      const organization = await deps.organizationService.getOrganization(organizationId);
      if (!organization) {
        res.status(404).json({ error: "Organization not found." });
        return;
      }

      const parsedQuery = knowledgeListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "Invalid query parameters." });
        return;
      }

      const entries = await deps.knowledgeService.listKnowledge(organizationId, parsedQuery.data);
      const knowledge: RuntimeKnowledgeEntry[] = entries.map((e) => ({
        id: e.id,
        title: e.title,
        content: e.content,
        category: e.category,
        active: e.active,
      }));
      res.status(200).json({ knowledge });
    },

    /**
     * M7: resolves an inbound Twilio call's dialed number to the
     * organization it belongs to, and mints a short-lived, call-bound
     * credential (auth/call-credential.ts) for that one call -- the sole
     * minting site for M7 call credentials. Deliberately guarded by
     * requireServiceAuth ONLY (see routes/internal.routes.ts): the caller
     * cannot present an organization-scoped credential for an organization
     * it doesn't know yet, so this is the one internal-API route that
     * establishes organization identity rather than verifying it against
     * an already-known :organizationId.
     *
     * Never logs the phone number, callSid, or the minted credential --
     * only structural outcomes (found/not-found) reach any logger, via the
     * standard pino-http request logger in app.ts (status code only).
     */
    async lookupPhoneNumber(req: Request, res: Response): Promise<void> {
      const phoneNumber = req.params.phoneNumber as string;
      const callSid = typeof req.query.callSid === "string" ? req.query.callSid : undefined;
      if (!callSid) {
        res.status(400).json({ error: "Missing callSid query parameter." });
        return;
      }

      const match = await deps.organizationPhoneNumbers.findByPhoneNumber(phoneNumber);
      if (!match) {
        res.status(404).json({ error: "No organization is mapped to this phone number." });
        return;
      }

      const callCredential = generateCallCredential(
        match.organizationId,
        callSid,
        deps.twilioCallCredentialSecret,
      );
      res.status(200).json({ organizationId: match.organizationId, callCredential });
    },
  };
}
