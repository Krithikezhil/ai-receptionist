import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { NewUser, User, UserRepository } from "../types.js";

function toDomain(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt,
  };
}

export function createDrizzleUserRepository(db: Database): UserRepository {
  return {
    async findByEmail(email) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ? toDomain(row) : undefined;
    },

    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(newUser: NewUser) {
      const [row] = await db
        .insert(users)
        .values({ email: newUser.email, passwordHash: newUser.passwordHash })
        .returning();
      if (!row) throw new Error("Failed to create user");
      return toDomain(row);
    },
  };
}
