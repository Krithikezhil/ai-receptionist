import type { Request, Response } from "express";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../auth/cookies.js";
import { EmailAlreadyExistsError, InvalidCredentialsError } from "../services/auth.errors.js";
import type { AuthService } from "../services/auth.service.js";
import { loginSchema, registerSchema } from "../validation/auth.schemas.js";

export function createAuthController(authService: AuthService) {
  return {
    async register(req: Request, res: Response): Promise<void> {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid registration data." });
        return;
      }

      try {
        const result = await authService.register(parsed.data.email, parsed.data.password);
        setSessionCookie(res, result.sessionToken, result.sessionExpiresAt);
        res.status(201).json({ user: result.user });
      } catch (err) {
        if (err instanceof EmailAlreadyExistsError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    },

    async login(req: Request, res: Response): Promise<void> {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        // Same status/shape as invalid credentials — do not let malformed
        // input distinguish itself from a genuine failed login attempt.
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }

      try {
        const result = await authService.login(parsed.data.email, parsed.data.password);
        setSessionCookie(res, result.sessionToken, result.sessionExpiresAt);
        res.status(200).json({ user: result.user });
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          res.status(401).json({ error: err.message });
          return;
        }
        throw err;
      }
    },

    async logout(req: Request, res: Response): Promise<void> {
      const token = readSessionToken(req);
      if (token) {
        await authService.logout(token);
      }
      clearSessionCookie(res);
      res.status(204).send();
    },

    me(req: Request, res: Response): void {
      // req.user is guaranteed by the requireAuth middleware mounted on this route.
      res.status(200).json({ user: req.user });
    },
  };
}
