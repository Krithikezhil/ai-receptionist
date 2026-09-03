import { Router } from "express";
import { createBusinessHoursController } from "../controllers/business-hours.controller.js";
import { createBusinessProfileController } from "../controllers/business-profile.controller.js";
import { createOrganizationController } from "../controllers/organization.controller.js";
import { createServiceCatalogController } from "../controllers/service-catalog.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireOrgMembership } from "../middleware/require-org-membership.js";
import type { MembershipRepository } from "../repositories/organization-types.js";
import type { AuthService } from "../services/auth.service.js";
import type { BusinessHoursService } from "../services/business-hours.service.js";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import type { OrganizationService } from "../services/organization.service.js";
import type { ServicesCatalogService } from "../services/services-catalog.service.js";

export interface OrganizationRouterDeps {
  authService: AuthService;
  memberships: MembershipRepository;
  organizationService: OrganizationService;
  businessProfileService: BusinessProfileService;
  businessHoursService: BusinessHoursService;
  servicesCatalogService: ServicesCatalogService;
}

export function createOrganizationsRouter(deps: OrganizationRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.authService);
  const membership = requireOrgMembership(deps.memberships);

  const org = createOrganizationController(deps.organizationService);
  const profile = createBusinessProfileController(deps.businessProfileService);
  const hours = createBusinessHoursController(deps.businessHoursService);
  const catalog = createServiceCatalogController(deps.servicesCatalogService);

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

  return router;
}
