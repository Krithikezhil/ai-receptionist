import { parseCookie } from "cookie";
import type { Request, Response } from "express";
import { env } from "../config/env.js";

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
  });
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[env.sessionCookieName];
}
