import type { Request, Response } from "express";
import type { ReceptionistConfigService } from "../services/receptionist-config.service.js";
import { updateReceptionistConfigSchema } from "../validation/receptionist-config.schemas.js";

export function createReceptionistConfigController(configService: ReceptionistConfigService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const config = await configService.getReceptionistConfig(req.params.organizationId as string);
      if (!config) {
        res.status(404).json({ error: "Receptionist configuration not found." });
        return;
      }
      res.status(200).json({ receptionistConfig: config });
    },

    async update(req: Request, res: Response): Promise<void> {
      const parsed = updateReceptionistConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid receptionist configuration data." });
        return;
      }

      const config = await configService.updateReceptionistConfig(
        req.params.organizationId as string,
        parsed.data,
      );
      res.status(200).json({ receptionistConfig: config });
    },
  };
}
