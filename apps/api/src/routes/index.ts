import { Router } from "express";
import type { AuthService } from "../services/auth.service.js";
import { createAuthRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";

export function createApiRouter(authService: AuthService): Router {
  const router = Router();
  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter(authService));
  return router;
}
