import { Router } from "express";
import type { OrganizationRouterDeps } from "./organizations.routes.js";
import { createOrganizationsRouter } from "./organizations.routes.js";
import { createAuthRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";
import type { InternalRouterDeps } from "./internal.routes.js";
import { createInternalRouter } from "./internal.routes.js";

export function createApiRouter(
  orgDeps: OrganizationRouterDeps,
  internalDeps: InternalRouterDeps,
): Router {
  const router = Router();
  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter(orgDeps.authService));
  router.use("/organizations", createOrganizationsRouter(orgDeps));
  router.use("/internal/v1", createInternalRouter(internalDeps));
  return router;
}
