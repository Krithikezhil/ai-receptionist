import { getDb } from "../db/client.js";
import { createDrizzleSessionRepository } from "./drizzle/session.repository.js";
import { createDrizzleUserRepository } from "./drizzle/user.repository.js";
import type { SessionRepository, UserRepository } from "./types.js";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
}

export function createRepositories(): Repositories {
  const db = getDb();
  return {
    users: createDrizzleUserRepository(db),
    sessions: createDrizzleSessionRepository(db),
  };
}

export type { SessionRepository, UserRepository } from "./types.js";
