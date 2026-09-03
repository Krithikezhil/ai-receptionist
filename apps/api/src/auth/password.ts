import { createHmac } from "node:crypto";
import argon2 from "argon2";
import { env } from "../config/env.js";

/**
 * Argon2id (argon2's default mode) with its default work factor
 * (m=65536,p=4,t=3), OWASP's current first-choice password hashing
 * algorithm. See ARCHITECTURE.md "Authentication" for why this was chosen
 * over bcrypt/scrypt.
 */

function requireAuthSecret(): string {
  if (!env.authSecret) {
    throw new Error("AUTH_SECRET is not set — refusing to hash/verify passwords without it.");
  }
  return env.authSecret;
}

/**
 * HMACs the password with AUTH_SECRET before hashing (a "pepper" — OWASP
 * Password Storage Cheat Sheet's documented defense-in-depth technique).
 * This is standard use of a keyed hash primitive, not custom cryptography:
 * a database-only leak is insufficient to crack passwords offline without
 * also having AUTH_SECRET.
 */
function pepper(password: string): string {
  return createHmac("sha256", requireAuthSecret()).update(password, "utf8").digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(pepper(password));
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, pepper(password));
}

/**
 * A hash of a fixed, non-existent password. Used by the login flow to run
 * argon2.verify even when no matching user was found, so response timing
 * doesn't reveal account existence. Computed lazily (needs AUTH_SECRET).
 */
let dummyHashPromise: Promise<string> | undefined;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing-safety");
  return dummyHashPromise;
}
