import type { Request, Response } from "express";
import type { PhoneNumberService } from "../services/phone-number.service.js";
import { createPhoneNumberSchema } from "../validation/organization.schemas.js";

/**
 * M7: /organizations/:organizationId/phone-numbers -- lets an organization
 * owner map a Twilio number to their organization (see
 * repositories/organization-phone-number-types.ts). Mounted behind the
 * same `auth, membership` chain every other organization-scoped route
 * uses (routes/organizations.routes.ts); GET is open to any member
 * (matches every other read endpoint's convention), but create/remove
 * additionally require the owner role -- the first place this codebase
 * checks membership.role for anything beyond organization creation,
 * because assigning/removing a number is a billing-relevant action, not a
 * new RBAC system (see the approved M7 plan §11).
 */
export function createPhoneNumberController(service: PhoneNumberService) {
  function requireOwner(req: Request, res: Response): boolean {
    if (req.membership?.role !== "owner") {
      res.status(403).json({ error: "Only an organization owner can manage phone numbers." });
      return false;
    }
    return true;
  }

  return {
    async list(req: Request, res: Response): Promise<void> {
      const phoneNumbers = await service.listPhoneNumbers(req.params.organizationId as string);
      res.status(200).json({ phoneNumbers });
    },

    async create(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;

      const parsed = createPhoneNumberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid phone number. Use E.164 format, e.g. +15551234567." });
        return;
      }

      const phoneNumber = await service.addPhoneNumber(
        req.params.organizationId as string,
        parsed.data.phoneNumber,
      );
      if (!phoneNumber) {
        res.status(409).json({ error: "This phone number is already assigned." });
        return;
      }
      res.status(201).json({ phoneNumber });
    },

    async remove(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;

      const removed = await service.removePhoneNumber(
        req.params.organizationId as string,
        req.params.phoneNumberId as string,
      );
      if (!removed) {
        res.status(404).json({ error: "Phone number not found." });
        return;
      }
      res.status(204).send();
    },
  };
}
