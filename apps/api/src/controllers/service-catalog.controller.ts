import type { Request, Response } from "express";
import type { ServiceItemUpdate } from "../repositories/organization-types.js";
import type { ServicesCatalogService } from "../services/services-catalog.service.js";
import { createServiceSchema, updateServiceSchema } from "../validation/organization.schemas.js";

export function createServiceCatalogController(catalogService: ServicesCatalogService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const services = await catalogService.listServices(req.params.organizationId as string);
      res.status(200).json({ services });
    },

    async create(req: Request, res: Response): Promise<void> {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid service data." });
        return;
      }

      const service = await catalogService.createService(req.params.organizationId as string, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        durationMinutes: parsed.data.durationMinutes,
        price: parsed.data.price != null ? String(parsed.data.price) : null,
        active: parsed.data.active ?? true,
      });
      res.status(201).json({ service });
    },

    async update(req: Request, res: Response): Promise<void> {
      const parsed = updateServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid service data." });
        return;
      }

      const changes: ServiceItemUpdate = {};
      if (parsed.data.name !== undefined) changes.name = parsed.data.name;
      if (parsed.data.description !== undefined) changes.description = parsed.data.description;
      if (parsed.data.durationMinutes !== undefined) {
        changes.durationMinutes = parsed.data.durationMinutes;
      }
      if (parsed.data.price !== undefined) {
        changes.price = parsed.data.price != null ? String(parsed.data.price) : null;
      }
      if (parsed.data.active !== undefined) changes.active = parsed.data.active;

      const service = await catalogService.updateService(
        req.params.organizationId as string,
        req.params.serviceId as string,
        changes,
      );
      if (!service) {
        res.status(404).json({ error: "Service not found." });
        return;
      }
      res.status(200).json({ service });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const deleted = await catalogService.deleteService(
        req.params.organizationId as string,
        req.params.serviceId as string,
      );
      if (!deleted) {
        res.status(404).json({ error: "Service not found." });
        return;
      }
      res.status(204).send();
    },
  };
}
