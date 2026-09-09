import type { RuntimeContext, RuntimeKnowledgeEntry } from "@ai-receptionist/shared";
import type { Request, Response } from "express";
import { generateCallCredential } from "../auth/call-credential.js";
import type { NewLead } from "../repositories/lead-types.js";
import type { OrganizationPhoneNumberRepository } from "../repositories/organization-phone-number-types.js";
import type { AppointmentService, BookAppointmentInput } from "../services/appointment.service.js";
import type { BusinessHoursService } from "../services/business-hours.service.js";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import type { KnowledgeService } from "../services/knowledge.service.js";
import { EmptyLeadError, type LeadService } from "../services/lead.service.js";
import type { OrganizationService } from "../services/organization.service.js";
import type { ReceptionistConfigService } from "../services/receptionist-config.service.js";
import type { ServicesCatalogService } from "../services/services-catalog.service.js";
import {
  createAppointmentSchema,
  internalCheckAvailabilityQuerySchema,
} from "../validation/appointment.schemas.js";
import { createLeadSchema } from "../validation/lead.schemas.js";
import { knowledgeListQuerySchema } from "../validation/knowledge.schemas.js";

export interface InternalControllerDeps {
  organizationService: OrganizationService;
  businessProfileService: BusinessProfileService;
  businessHoursService: BusinessHoursService;
  servicesCatalogService: ServicesCatalogService;
  knowledgeService: KnowledgeService;
  leadService: LeadService;
  receptionistConfigService: ReceptionistConfigService;
  organizationPhoneNumbers: OrganizationPhoneNumberRepository;
  appointmentService: AppointmentService;
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

      const entries = await deps.knowledgeService.searchKnowledge(organizationId, parsedQuery.data);
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
     * M9 Step 6: the first write-capable internal-API handler. organizationId
     * comes only from the already-authenticated :organizationId route param
     * (verified by requireServiceAuth + requireOrganizationAuth before this
     * handler ever runs -- see routes/internal.routes.ts), never from the
     * request body -- same discipline as every other handler in this file.
     * createLeadSchema's own .refine() already rejects a completely empty
     * lead at 400 before the service is ever reached; the EmptyLeadError
     * catch below is unreachable via this endpoint today, kept only as the
     * same belt-and-suspenders defense-in-depth this codebase already uses
     * elsewhere (see organization.service.ts). No lead content
     * (contactName/contactPhone/contactEmail/intent/notes/callSid) is ever
     * logged -- this handler makes no logger call.
     */
    async createLead(req: Request, res: Response): Promise<void> {
      const organizationId = req.params.organizationId as string;

      const parsed = createLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid lead data." });
        return;
      }

      // exactOptionalPropertyTypes: an absent key and a key explicitly set
      // to `undefined` are distinct types -- zod's .optional() infers the
      // latter, NewLead's fields require the former. Mirrors the same
      // `if (x !== undefined)` pattern service-catalog.controller.ts's
      // update handler already uses for this exact class of mismatch.
      const input: Omit<NewLead, "organizationId" | "status"> = {};
      if (parsed.data.contactName !== undefined) input.contactName = parsed.data.contactName;
      if (parsed.data.contactPhone !== undefined) input.contactPhone = parsed.data.contactPhone;
      if (parsed.data.contactEmail !== undefined) input.contactEmail = parsed.data.contactEmail;
      if (parsed.data.intent !== undefined) input.intent = parsed.data.intent;
      if (parsed.data.notes !== undefined) input.notes = parsed.data.notes;
      if (parsed.data.callSid !== undefined) input.callSid = parsed.data.callSid;

      try {
        const lead = await deps.leadService.createLead(organizationId, input);
        res.status(201).json({ lead });
      } catch (err) {
        if (err instanceof EmptyLeadError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
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

    /**
     * M10 Step 7: GET /internal/v1/organizations/:id/appointments/availability
     * -- thin pass-through to AppointmentService.checkAvailability(), which
     * already owns all business-hours/local-overlap/Google-FreeBusy logic.
     * No new business logic lives here.
     */
    async checkAppointmentAvailability(req: Request, res: Response): Promise<void> {
      const organizationId = req.params.organizationId as string;

      const parsedQuery = internalCheckAvailabilityQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "Invalid query parameters." });
        return;
      }

      const result = await deps.appointmentService.checkAvailability(
        organizationId,
        parsedQuery.data.serviceId,
        parsedQuery.data.date,
        parsedQuery.data.time,
      );

      switch (result.status) {
        case "ok": {
          const body: {
            status: "ok";
            slots: string[];
            requestedTimeAvailable?: boolean;
            alternatives?: string[];
          } = { status: "ok", slots: result.slots };
          if (result.requestedTimeAvailable !== undefined) {
            body.requestedTimeAvailable = result.requestedTimeAvailable;
          }
          if (result.alternatives !== undefined) {
            body.alternatives = result.alternatives;
          }
          res.status(200).json(body);
          return;
        }
        // Not the caller's fault -- a legitimate operational state, not an
        // error, matching the dashboard calendar-status endpoint's own
        // "200 with a status field" precedent.
        case "calendar_not_connected":
        case "calendar_unavailable":
          res.status(200).json({ status: result.status });
          return;
        case "service_not_found":
          res.status(404).json({ error: "Service not found." });
          return;
        // Server misconfiguration (the organization's business-profile
        // timezone is invalid) -- never the caller's fault.
        case "invalid_timezone":
          res.status(500).json({ error: "Organization is misconfigured." });
          return;
        case "invalid_date":
          res.status(400).json({ error: "Invalid date." });
          return;
        case "invalid_time":
          res.status(400).json({ error: "Invalid time." });
          return;
      }
    },

    /**
     * M10 Step 7: POST /internal/v1/organizations/:id/appointments -- thin
     * pass-through to AppointmentService.bookAppointment(), which already
     * owns the full booking-write ordering, overlap/duplicate-booking
     * checks, and Google Calendar compensation logic. No new business logic
     * lives here.
     *
     * callSid binding: when this request was authenticated via a short-
     * lived M7 call credential, req.verifiedCallSid (set by
     * requireOrganizationAuth -- see middleware/require-organization-auth.ts)
     * is authoritative. A body-supplied callSid is still accepted for
     * symmetry with capture_lead, but it must match the verified value
     * exactly or the request is rejected; when the body omits it, the
     * verified value is used automatically. On the M5 long-lived
     * per-organization-token path, req.verifiedCallSid is never set, so
     * callSid (if any) continues to come from the body alone -- identical,
     * unchanged behavior to createLead above.
     */
    async bookAppointment(req: Request, res: Response): Promise<void> {
      const organizationId = req.params.organizationId as string;

      const parsed = createAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid appointment data." });
        return;
      }

      let callSid = parsed.data.callSid ?? undefined;
      if (req.verifiedCallSid !== undefined) {
        if (callSid !== undefined && callSid !== req.verifiedCallSid) {
          res.status(400).json({ error: "callSid does not match the authenticated call." });
          return;
        }
        callSid = req.verifiedCallSid;
      }

      const input: BookAppointmentInput = {
        serviceId: parsed.data.serviceId,
        date: parsed.data.date,
        time: parsed.data.time,
      };
      if (parsed.data.customerName !== undefined) input.customerName = parsed.data.customerName;
      if (parsed.data.customerPhone !== undefined) input.customerPhone = parsed.data.customerPhone;
      if (parsed.data.customerEmail !== undefined) input.customerEmail = parsed.data.customerEmail;
      if (parsed.data.notes !== undefined) input.notes = parsed.data.notes;
      if (callSid !== undefined) input.callSid = callSid;

      const result = await deps.appointmentService.bookAppointment(organizationId, input);

      switch (result.status) {
        case "booked":
          res.status(201).json({ appointment: result.appointment });
          return;
        case "service_not_found":
          res.status(404).json({ error: "Service not found." });
          return;
        case "unavailable":
          res.status(409).json({ status: "unavailable", alternatives: result.alternatives });
          return;
        case "duplicate_booking":
          res.status(409).json({ status: "duplicate_booking" });
          return;
        case "calendar_not_connected":
        case "calendar_unavailable":
          res.status(200).json({ status: result.status });
          return;
        case "invalid_timezone":
          res.status(500).json({ error: "Organization is misconfigured." });
          return;
        case "booking_failed":
          res.status(500).json({ error: "Failed to complete the booking. Please try again." });
          return;
        case "invalid_time":
        case "nonexistent_time":
        case "ambiguous_time":
        case "past_time":
          res.status(400).json({ error: "Invalid or unavailable appointment time." });
          return;
      }
    },
  };
}
