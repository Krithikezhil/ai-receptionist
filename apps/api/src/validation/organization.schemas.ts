import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export const businessProfileSchema = z.object({
  businessName: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.email().nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const dayHoursSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: z.string().regex(HHMM).nullable(),
    closeTime: z.string().regex(HHMM).nullable(),
  })
  .refine(
    (day) =>
      !day.isOpen ||
      (day.openTime !== null && day.closeTime !== null && day.openTime < day.closeTime),
    {
      message: "Open days require openTime earlier than closeTime.",
    },
  );

export const businessHoursSchema = z
  .array(dayHoursSchema)
  .length(7)
  .refine(
    (entries) => {
      const days = new Set(entries.map((e) => e.dayOfWeek));
      return days.size === 7 && [0, 1, 2, 3, 4, 5, 6].every((d) => days.has(d));
    },
    { message: "Must include each day of the week (0-6) exactly once." },
  );

export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  price: z.coerce.number().nonnegative().max(999_999).nullable().optional(),
  active: z.boolean().optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
