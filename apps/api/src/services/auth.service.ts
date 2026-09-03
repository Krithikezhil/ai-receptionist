import { getDummyHash, hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, invalidateSessionToken, validateSessionToken } from "../auth/session.js";
import type { SessionRepository, User, UserRepository } from "../repositories/types.js";
import { EmailAlreadyExistsError, InvalidCredentialsError } from "./auth.errors.js";

export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
}

function toPublicUser(user: User): PublicUser {
  // Deliberately excludes passwordHash — never returned by any API response.
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

export interface AuthResult {
  user: PublicUser;
  sessionToken: string;
  sessionExpiresAt: Date;
}

export interface AuthService {
  register(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  logout(sessionToken: string): Promise<void>;
  getCurrentUser(sessionToken: string): Promise<PublicUser | undefined>;
}

export interface AuthServiceDeps {
  users: UserRepository;
  sessions: SessionRepository;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService({ users, sessions }: AuthServiceDeps): AuthService {
  return {
    async register(rawEmail, password) {
      const email = normalizeEmail(rawEmail);

      const existing = await users.findByEmail(email);
      if (existing) throw new EmailAlreadyExistsError();

      const passwordHash = await hashPassword(password);
      const user = await users.create({ email, passwordHash });
      const session = await createSession(sessions, user.id);

      return {
        user: toPublicUser(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      };
    },

    async login(rawEmail, password) {
      const email = normalizeEmail(rawEmail);
      const user = await users.findByEmail(email);

      // Always run a verify, even for a nonexistent user, against a fixed
      // dummy hash — keeps response timing similar so it can't be used to
      // enumerate which emails have accounts.
      const passwordMatches = user
        ? await verifyPassword(user.passwordHash, password)
        : await verifyPassword(await getDummyHash(), password).then(() => false);

      if (!user || !passwordMatches) throw new InvalidCredentialsError();

      const session = await createSession(sessions, user.id);

      return {
        user: toPublicUser(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      };
    },

    async logout(sessionToken) {
      await invalidateSessionToken(sessions, sessionToken);
    },

    async getCurrentUser(sessionToken) {
      const validated = await validateSessionToken({ sessions, users }, sessionToken);
      return validated ? toPublicUser(validated.user) : undefined;
    },
  };
}
