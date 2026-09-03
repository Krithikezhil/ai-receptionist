import type { Request, Response } from "express";
import type { OrganizationService } from "../services/organization.service.js";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from "../validation/organization.schemas.js";

export function createOrganizationController(orgService: OrganizationService) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const parsed = createOrganizationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid organization data." });
        return;
      }

      const result = await orgService.createOrganization(req.user!.id, parsed.data.name);
      res.status(201).json({
        organization: result.organization,
        membership: result.membership,
        businessProfile: result.businessProfile,
        receptionistConfig: result.receptionistConfig,
      });
    },

    async list(req: Request, res: Response): Promise<void> {
      const organizations = await orgService.listOrganizationsForUser(req.user!.id);
      res.status(200).json({ organizations });
    },

    async get(req: Request, res: Response): Promise<void> {
      // requireOrgMembership already verified access before this runs.
      const organization = await orgService.getOrganization(req.params.organizationId as string);
      if (!organization) {
        res.status(404).json({ error: "Organization not found." });
        return;
      }
      res.status(200).json({ organization });
    },

    async update(req: Request, res: Response): Promise<void> {
      const parsed = updateOrganizationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid organization data." });
        return;
      }

      const organization = await orgService.updateOrganization(
        req.params.organizationId as string,
        parsed.data,
      );
      if (!organization) {
        res.status(404).json({ error: "Organization not found." });
        return;
      }
      res.status(200).json({ organization });
    },
  };
}
