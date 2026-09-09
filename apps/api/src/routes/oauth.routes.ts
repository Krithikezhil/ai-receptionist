import { Router } from "express";
import { createCalendarConnectionController } from "../controllers/calendar-connection.controller.js";
import type { CalendarConnectionService } from "../services/calendar-connection.service.js";

/**
 * The fixed Google OAuth callback -- deliberately outside
 * /organizations/:organizationId (Google requires one pre-registered,
 * organization-agnostic redirect URI) and mounted with NO
 * requireAuth/requireOrgMembership: there is no authenticated dashboard
 * session at this point in the flow, and organization context comes
 * exclusively from the verified signed state (see auth/oauth-state.ts),
 * never from any request parameter. See the approved M10 Step 6 plan.
 */
export function createOAuthRouter(calendarConnectionService: CalendarConnectionService): Router {
  const router = Router();
  const controller = createCalendarConnectionController(calendarConnectionService);
  router.get("/google/callback", controller.handleOAuthCallback);
  return router;
}
