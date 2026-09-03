import type { NextFunction, Request, Response } from "express";
import { readSessionToken } from "../auth/cookies.js";
import type { AuthService, PublicUser } from "../services/auth.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

/**
 * Server-side authentication boundary. This is what actually protects an
 * endpoint — any frontend-side route protection is UX only, never trusted.
 * See SECURITY.md "Backend security boundary".
 */
export function requireAuth(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readSessionToken(req);
    const user = token ? await authService.getCurrentUser(token) : undefined;

    if (!user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    req.user = user;
    next();
  };
}
