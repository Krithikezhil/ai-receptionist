import { z } from "zod";

export const updateReceptionistConfigSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  greeting: z.string().trim().min(1).max(2000).optional(),
  tone: z.string().trim().min(1).max(500).optional(),
  instructions: z.string().trim().max(5000).optional(),
  fallbackMessage: z.string().trim().min(1).max(2000).optional(),
  afterHoursMessage: z.string().trim().min(1).max(2000).optional(),
  callTransferEnabled: z.boolean().optional(),
  callTransferPhone: z.string().trim().max(50).nullable().optional(),
  language: z.string().trim().min(2).max(35).optional(),
});

export type UpdateReceptionistConfigInput = z.infer<typeof updateReceptionistConfigSchema>;
