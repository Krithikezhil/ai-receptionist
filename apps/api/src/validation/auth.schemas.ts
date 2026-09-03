import { z } from "zod";

// Length-based only (no forced complexity rules), per current NIST 800-63B
// guidance: a reasonable minimum length is a stronger real-world signal
// than mandated character-class composition.
export const registerSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(8).max(256),
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(256),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
