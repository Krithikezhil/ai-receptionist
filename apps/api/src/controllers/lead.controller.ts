import type { Request, Response } from "express";
import type { LeadService } from "../services/lead.service.js";
import { leadListQuerySchema, updateLeadStatusSchema } from "../validation/lead.schemas.js";

/**
 * M9 Step 5: dashboard-only endpoints. No create handler here -- leads are
 * only ever created by the voice agent's capture_lead tool (a later M9
 * step), never typed in by a dashboard user. Status filtering happens here
 * (in-memory, after fetching the full org list) rather than in
 * LeadRepository/LeadService, which deliberately take no filter parameter
 * (see M9 Steps 2/4) -- this keeps that already-approved layer unchanged.
 */
export function createLeadController(leadService: LeadService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const parsedQuery = leadListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "Invalid query parameters." });
        return;
      }

      const leads = await leadService.listLeads(req.params.organizationId as string);
      const filtered = parsedQuery.data.status
        ? leads.filter((lead) => lead.status === parsedQuery.data.status)
        : leads;
      res.status(200).json({ leads: filtered });
    },

    async updateStatus(req: Request, res: Response): Promise<void> {
      const parsed = updateLeadStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid lead status." });
        return;
      }

      const lead = await leadService.updateLeadStatus(
        req.params.organizationId as string,
        req.params.leadId as string,
        parsed.data,
      );
      if (!lead) {
        res.status(404).json({ error: "Lead not found." });
        return;
      }
      res.status(200).json({ lead });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const deleted = await leadService.deleteLead(
        req.params.organizationId as string,
        req.params.leadId as string,
      );
      if (!deleted) {
        res.status(404).json({ error: "Lead not found." });
        return;
      }
      res.status(204).send();
    },
  };
}
