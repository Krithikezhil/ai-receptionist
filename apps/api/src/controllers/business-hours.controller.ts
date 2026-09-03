import type { Request, Response } from "express";
import type { BusinessHoursService } from "../services/business-hours.service.js";
import { businessHoursSchema } from "../validation/organization.schemas.js";

export function createBusinessHoursController(hoursService: BusinessHoursService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const businessHours = await hoursService.getBusinessHours(
        req.params.organizationId as string,
      );
      res.status(200).json({ businessHours });
    },

    async replace(req: Request, res: Response): Promise<void> {
      const parsed = businessHoursSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid business hours data." });
        return;
      }

      const businessHours = await hoursService.replaceBusinessHours(
        req.params.organizationId as string,
        parsed.data,
      );
      res.status(200).json({ businessHours });
    },
  };
}
