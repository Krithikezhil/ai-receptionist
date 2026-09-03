import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import type { SessionRepository, User, UserRepository } from "../repositories/types.js";

const SESSION_TOKEN_BYTES = 20;

/**
 * Database-session pattern: the raw token goes to the client in a cookie;
 * only its SHA-256 hash is ever persisted server-side (see db/schema.ts).
 * This follows the pattern documented at https://lucia-auth.com/sessions/basic
 * (Lucia is no longer a maintained library, but its authors continue to
 * publish this as the recommended reference implementation for exactly
 * this kind of hashed-token session — see ARCHITECTURE.md).
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ttlMs(): number {
  return env.sessionTtlDays * 24 * 60 * 60 * 1000;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  sessionRepository: SessionRepository,
  userId: string,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await sessionRepository.create({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export interface ValidatedSession {
  user: User;
  expiresAt: Date;
}

export interface SessionRepositories {
  sessions: SessionRepository;
  users: UserRepository;
}

/**
 * Validates a raw session token from a cookie. Deletes and rejects expired
 * sessions (fail closed) rather than trusting stale rows.
 */
export async function validateSessionToken(
  repos: SessionRepositories,
  token: string,
): Promise<ValidatedSession | undefined> {
  const id = hashToken(token);
  const session = await repos.sessions.findById(id);
  if (!session) return undefined;

  if (session.expiresAt.getTime() <= Date.now()) {
    await repos.sessions.deleteById(id);
    return undefined;
  }

  const user = await repos.users.findById(session.userId);
  if (!user) {
    await repos.sessions.deleteById(id);
    return undefined;
  }

  return { user, expiresAt: session.expiresAt };
}

export async function invalidateSessionToken(
  sessionRepository: SessionRepository,
  token: string,
): Promise<void> {
  await sessionRepository.deleteById(hashToken(token));
}
