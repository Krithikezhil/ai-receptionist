import { Router } from "express";
import {
  createInternalController,
  type InternalControllerDeps,
} from "../controllers/internal.controller.js";
import type { OrganizationServiceCredentialRepository } from "../repositories/organization-service-credential-types.js";
import { requireOrganizationAuth } from "../middleware/require-organization-auth.js";
import { requireServiceAuth } from "../middleware/require-service-auth.js";

export interface InternalRouterDeps extends InternalControllerDeps {
  internalServiceKey: string;
  organizationServiceCredentials: OrganizationServiceCredentialRepository;
}

/**
 * /internal/v1/* — the service-to-service surface consumed by
 * services/voice-agent, guarded by two independent checks (mirroring the
 * public router's `auth, membership` chain):
 *   1. requireServiceAuth — is this caller a trusted internal service at
 *      all? (Authorization: Bearer INTERNAL_SERVICE_KEY, 401 otherwise.)
 *   2. requireOrganizationAuth — is it authorized for THIS specific
 *      :organizationId? (X-Organization-Service-Token, checked as EITHER a
 *      short-lived M7 call credential OR the M5 per-organization hash,
 *      403/404 otherwise — see middleware/require-organization-auth.ts,
 *      which composes the unmodified M5 check rather than replacing it.)
 * Neither check alone establishes tenant authorization — see
 * ARCHITECTURE.md "Internal voice API" and SECURITY.md
 * "Service-to-service authentication".
 *
 * `/twilio/phone-numbers/:phoneNumber` is deliberately guarded by
 * requireServiceAuth ONLY: it is what *establishes* which organization an
 * inbound call belongs to, so there is no :organizationId to check a token
 * against yet — see controllers/internal.controller.ts's lookupPhoneNumber.
 */
export function createInternalRouter(deps: InternalRouterDeps): Router {
  const router = Router();
  const serviceAuth = requireServiceAuth(deps.internalServiceKey);
  const organizationAuth = requireOrganizationAuth(
    deps.organizationServiceCredentials,
    deps.twilioCallCredentialSecret,
  );
  const controller = createInternalController(deps);

  router.get(
    "/organizations/:organizationId/runtime-context",
    serviceAuth,
    organizationAuth,
    controller.getRuntimeContext,
  );
  router.get(
    "/organizations/:organizationId/knowledge",
    serviceAuth,
    organizationAuth,
    controller.listKnowledge,
  );
  // M9 Step 6: the first write-capable route on this router. Same
  // two-stage auth chain as every GET above -- no new middleware.
  router.post(
    "/organizations/:organizationId/leads",
    serviceAuth,
    organizationAuth,
    controller.createLead,
  );
  router.get("/twilio/phone-numbers/:phoneNumber", serviceAuth, controller.lookupPhoneNumber);
  // M10 Step 7: same two-stage auth chain as every route above.
  router.get(
    "/organizations/:organizationId/appointments/availability",
    serviceAuth,
    organizationAuth,
    controller.checkAppointmentAvailability,
  );
  router.post(
    "/organizations/:organizationId/appointments",
    serviceAuth,
    organizationAuth,
    controller.bookAppointment,
  );

  return router;
}
