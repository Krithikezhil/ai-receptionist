import { randomUUID } from "node:crypto";
import type {
  NewSession,
  NewUser,
  Session,
  SessionRepository,
  User,
  UserRepository,
} from "../../src/repositories/types.js";

/**
 * Test doubles implementing the same repository interfaces the real
 * Drizzle/Postgres repositories implement (src/repositories/drizzle/*).
 * Used only in tests — production code always uses the Postgres-backed
 * implementations. See ARCHITECTURE.md "Authentication" for why.
 */
export function createInMemoryUserRepository(): UserRepository {
  const users = new Map<string, User>();

  return {
    async findByEmail(email) {
      return [...users.values()].find((u) => u.email === email);
    },
    async findById(id) {
      return users.get(id);
    },
    async create(newUser: NewUser) {
      const user: User = {
        id: randomUUID(),
        email: newUser.email,
        passwordHash: newUser.passwordHash,
        createdAt: new Date(),
      };
      users.set(user.id, user);
      return user;
    },
  };
}

export function createInMemorySessionRepository(): SessionRepository {
  const sessions = new Map<string, Session>();

  return {
    async create(newSession: NewSession) {
      const session: Session = { ...newSession };
      sessions.set(session.id, session);
      return session;
    },
    async findById(id) {
      return sessions.get(id);
    },
    async deleteById(id) {
      sessions.delete(id);
    },
  };
}
