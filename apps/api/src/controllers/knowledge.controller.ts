import type { Request, Response } from "express";
import type { KnowledgeService } from "../services/knowledge.service.js";
import {
  createKnowledgeSchema,
  knowledgeListQuerySchema,
  updateKnowledgeSchema,
} from "../validation/knowledge.schemas.js";

export function createKnowledgeController(knowledgeService: KnowledgeService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const parsedQuery = knowledgeListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "Invalid query parameters." });
        return;
      }

      const entries = await knowledgeService.listKnowledge(
        req.params.organizationId as string,
        parsedQuery.data,
      );
      res.status(200).json({ knowledge: entries });
    },

    async create(req: Request, res: Response): Promise<void> {
      const parsed = createKnowledgeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid knowledge entry data." });
        return;
      }

      const entry = await knowledgeService.createKnowledge(
        req.params.organizationId as string,
        parsed.data,
      );
      res.status(201).json({ knowledge: entry });
    },

    async update(req: Request, res: Response): Promise<void> {
      const parsed = updateKnowledgeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid knowledge entry data." });
        return;
      }

      const entry = await knowledgeService.updateKnowledge(
        req.params.organizationId as string,
        req.params.knowledgeId as string,
        parsed.data,
      );
      if (!entry) {
        res.status(404).json({ error: "Knowledge entry not found." });
        return;
      }
      res.status(200).json({ knowledge: entry });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const deleted = await knowledgeService.deleteKnowledge(
        req.params.organizationId as string,
        req.params.knowledgeId as string,
      );
      if (!deleted) {
        res.status(404).json({ error: "Knowledge entry not found." });
        return;
      }
      res.status(204).send();
    },
  };
}
