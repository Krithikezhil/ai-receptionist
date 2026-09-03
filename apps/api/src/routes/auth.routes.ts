import { Router } from "express";
import { createAuthController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import type { AuthService } from "../services/auth.service.js";

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();
  const controller = createAuthController(authService);

  router.post("/register", controller.register);
  router.post("/login", controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", requireAuth(authService), controller.me);

  return router;
}
