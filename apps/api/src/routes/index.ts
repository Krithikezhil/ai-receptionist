import { Router } from "express";
import type { OrganizationRouterDeps } from "./organizations.routes.js";
import { createOrganizationsRouter } from "./organizations.routes.js";
import { createAuthRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";

export function createApiRouter(orgDeps: OrganizationRouterDeps): Router {
  const router = Router();
  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter(orgDeps.authService));
  router.use("/organizations", createOrganizationsRouter(orgDeps));
  return router;
}
