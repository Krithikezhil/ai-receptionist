import { z } from "zod";

const knowledgeCategory = z.enum(["faq", "policy", "service_info", "custom"]);

export const createKnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10_000),
  category: knowledgeCategory.optional(),
  active: z.boolean().optional(),
});

export const updateKnowledgeSchema = createKnowledgeSchema.partial();

export const knowledgeListQuerySchema = z.object({
  category: knowledgeCategory.optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  q: z.string().trim().min(1).max(200).optional(),
});

export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;
export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeSchema>;
