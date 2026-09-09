import { Router } from "express";
import { createAppointmentController } from "../controllers/appointment.controller.js";
import { createBusinessHoursController } from "../controllers/business-hours.controller.js";
import { createBusinessProfileController } from "../controllers/business-profile.controller.js";
import { createCalendarConnectionController } from "../controllers/calendar-connection.controller.js";
import { createKnowledgeController } from "../controllers/knowledge.controller.js";
import { createLeadController } from "../controllers/lead.controller.js";
import { createOrganizationController } from "../controllers/organization.controller.js";
import { createPhoneNumberController } from "../controllers/phone-number.controller.js";
import { createReceptionistConfigController } from "../controllers/receptionist-config.controller.js";
import { createServiceCatalogController } from "../controllers/service-catalog.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireOrgMembership } from "../middleware/require-org-membership.js";
import type { MembershipRepository } from "../repositories/organization-types.js";
import type { AppointmentService } from "../services/appointment.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { BusinessHoursService } from "../services/business-hours.service.js";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import type { CalendarConnectionService } from "../services/calendar-connection.service.js";
import type { KnowledgeService } from "../services/knowledge.service.js";
import type { LeadService } from "../services/lead.service.js";
import type { OrganizationService } from "../services/organization.service.js";
import type { PhoneNumberService } from "../services/phone-number.service.js";
import type { ReceptionistConfigService } from "../services/receptionist-config.service.js";
import type { ServicesCatalogService } from "../services/services-catalog.service.js";

export interface OrganizationRouterDeps {
  authService: AuthService;
  memberships: MembershipRepository;
  organizationService: OrganizationService;
  businessProfileService: BusinessProfileService;
  businessHoursService: BusinessHoursService;
  servicesCatalogService: ServicesCatalogService;
  knowledgeService: KnowledgeService;
  leadService: LeadService;
  receptionistConfigService: ReceptionistConfigService;
  phoneNumberService: PhoneNumberService;
  appointmentService: AppointmentService;
  calendarConnectionService: CalendarConnectionService;
}

export function createOrganizationsRouter(deps: OrganizationRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.authService);
  const membership = requireOrgMembership(deps.memberships);

  const org = createOrganizationController(deps.organizationService);
  const profile = createBusinessProfileController(deps.businessProfileService);
  const hours = createBusinessHoursController(deps.businessHoursService);
  const catalog = createServiceCatalogController(deps.servicesCatalogService);
  const knowledge = createKnowledgeController(deps.knowledgeService);
  const leads = createLeadController(deps.leadService);
  const receptionistConfig = createReceptionistConfigController(deps.receptionistConfigService);
  const phoneNumbers = createPhoneNumberController(deps.phoneNumberService);
  const appointments = createAppointmentController(deps.appointmentService);
  const calendarConnection = createCalendarConnectionController(deps.calendarConnectionService);

  router.post("/", auth, org.create);
  router.get("/", auth, org.list);
  router.get("/:organizationId", auth, membership, org.get);
  router.patch("/:organizationId", auth, membership, org.update);

  router.get("/:organizationId/business-profile", auth, membership, profile.get);
  router.put("/:organizationId/business-profile", auth, membership, profile.update);

  router.get("/:organizationId/business-hours", auth, membership, hours.get);
  router.put("/:organizationId/business-hours", auth, membership, hours.replace);

  router.get("/:organizationId/services", auth, membership, catalog.list);
  router.post("/:organizationId/services", auth, membership, catalog.create);
  router.patch("/:organizationId/services/:serviceId", auth, membership, catalog.update);
  router.delete("/:organizationId/services/:serviceId", auth, membership, catalog.remove);

  router.get("/:organizationId/knowledge", auth, membership, knowledge.list);
  router.post("/:organizationId/knowledge", auth, membership, knowledge.create);
  router.patch("/:organizationId/knowledge/:knowledgeId", auth, membership, knowledge.update);
  router.delete("/:organizationId/knowledge/:knowledgeId", auth, membership, knowledge.remove);

  // M9 Step 5: dashboard-only, status-update-only -- no POST here (leads
  // are only ever created by the voice agent's capture_lead tool, a later
  // M9 step). Every operation is scoped by :organizationId via auth +
  // membership, identical to every other resource in this router.
  router.get("/:organizationId/leads", auth, membership, leads.list);
  router.patch("/:organizationId/leads/:leadId", auth, membership, leads.updateStatus);
  router.delete("/:organizationId/leads/:leadId", auth, membership, leads.remove);

  router.get("/:organizationId/receptionist-config", auth, membership, receptionistConfig.get);
  router.put("/:organizationId/receptionist-config", auth, membership, receptionistConfig.update);

  // M7: create/remove additionally require the owner role -- enforced
  // inside the controller (requireOrgMembership itself doesn't distinguish
  // role, matching every other resource above; see phone-number.controller.ts).
  router.get("/:organizationId/phone-numbers", auth, membership, phoneNumbers.list);
  router.post("/:organizationId/phone-numbers", auth, membership, phoneNumbers.create);
  router.delete(
    "/:organizationId/phone-numbers/:phoneNumberId",
    auth,
    membership,
    phoneNumbers.remove,
  );

  // M10 Step 5: dashboard-only, status-update-only -- no POST here
  // (appointments are only ever created by the voice agent's
  // book_appointment tool, a later M10 step). PATCH only supports
  // cancellation -- enforced inside the controller, not the schema (see
  // appointment.controller.ts).
  router.get("/:organizationId/appointments", auth, membership, appointments.list);
  router.patch(
    "/:organizationId/appointments/:appointmentId",
    auth,
    membership,
    appointments.updateStatus,
  );

  // M10 Step 5: connect/disconnect additionally require the owner role --
  // enforced inside the controller (same pattern as phone-numbers above).
  // POST is a deliberate Step 5 placeholder (501) until Step 6 implements
  // the real Google OAuth start flow.
  router.get("/:organizationId/calendar", auth, membership, calendarConnection.getStatus);
  router.post("/:organizationId/calendar", auth, membership, calendarConnection.connect);
  router.delete("/:organizationId/calendar", auth, membership, calendarConnection.disconnect);

  return router;
}
