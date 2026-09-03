import type { Request, Response } from "express";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import { businessProfileSchema } from "../validation/organization.schemas.js";

export function createBusinessProfileController(profileService: BusinessProfileService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const profile = await profileService.getBusinessProfile(req.params.organizationId as string);
      if (!profile) {
        res.status(404).json({ error: "Business profile not found." });
        return;
      }
      res.status(200).json({ businessProfile: profile });
    },

    async update(req: Request, res: Response): Promise<void> {
      const parsed = businessProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid business profile data." });
        return;
      }

      const profile = await profileService.updateBusinessProfile(
        req.params.organizationId as string,
        parsed.data,
      );
      res.status(200).json({ businessProfile: profile });
    },
  };
}
