import { Router } from "express";
import {
  createInternalController,
  type InternalControllerDeps,
} from "../controllers/internal.controller.js";
import type { OrganizationServiceCredentialRepository } from "../repositories/organization-service-credential-types.js";
import { requireOrganizationServiceToken } from "../middleware/require-organization-service-token.js";
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
 *   2. requireOrganizationServiceToken — is it authorized for THIS specific
 *      :organizationId? (X-Organization-Service-Token, checked against a
 *      per-organization hash, 403/404 otherwise.)
 * Neither check alone establishes tenant authorization — see
 * ARCHITECTURE.md "Internal voice API" and SECURITY.md
 * "Service-to-service authentication".
 */
export function createInternalRouter(deps: InternalRouterDeps): Router {
  const router = Router();
  const serviceAuth = requireServiceAuth(deps.internalServiceKey);
  const organizationAuth = requireOrganizationServiceToken(deps.organizationServiceCredentials);
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

  return router;
}
