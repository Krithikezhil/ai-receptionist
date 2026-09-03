import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import type { NewSession, Session, SessionRepository } from "../types.js";

function toDomain(row: typeof sessions.$inferSelect): Session {
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

export function createDrizzleSessionRepository(db: Database): SessionRepository {
  return {
    async create(newSession: NewSession) {
      const [row] = await db.insert(sessions).values(newSession).returning();
      if (!row) throw new Error("Failed to create session");
      return toDomain(row);
    },

    async findById(id) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      return row ? toDomain(row) : undefined;
    },

    async deleteById(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
  };
}
