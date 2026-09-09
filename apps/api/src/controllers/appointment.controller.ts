import type { Request, Response } from "express";
import type { AppointmentService } from "../services/appointment.service.js";
import {
  appointmentListQuerySchema,
  updateAppointmentStatusSchema,
} from "../validation/appointment.schemas.js";

/**
 * M10 Step 5: dashboard-only endpoints. No create handler here --
 * appointments are only ever created by the voice agent's book_appointment
 * tool (a later M10 step), never typed in by a dashboard user. Status
 * filtering happens here (in-memory, after fetching the full org list)
 * rather than in AppointmentRepository/AppointmentService, mirroring
 * lead.controller.ts's exact precedent. PATCH only ever acts on
 * "cancelled" -- AppointmentService has no method for setting any other
 * status from the dashboard, so any other value is rejected here rather
 * than falling back to a raw repository update that would bypass
 * cancelAppointment's transition rules.
 */
export function createAppointmentController(appointmentService: AppointmentService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const parsedQuery = appointmentListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "Invalid query parameters." });
        return;
      }

      const appointments = await appointmentService.listAppointments(
        req.params.organizationId as string,
      );
      const filtered = parsedQuery.data.status
        ? appointments.filter((appointment) => appointment.status === parsedQuery.data.status)
        : appointments;
      res.status(200).json({ appointments: filtered });
    },

    async updateStatus(req: Request, res: Response): Promise<void> {
      const parsed = updateAppointmentStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid appointment status." });
        return;
      }
      if (parsed.data.status !== "cancelled") {
        res.status(400).json({ error: "Only cancellation is supported through this endpoint." });
        return;
      }

      const result = await appointmentService.cancelAppointment(
        req.params.organizationId as string,
        req.params.appointmentId as string,
      );
      if (result.status === "not_found") {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      if (result.status === "cannot_cancel") {
        res
          .status(409)
          .json({ error: "This appointment cannot be cancelled from its current status." });
        return;
      }
      res.status(200).json({ appointment: result.appointment });
    },
  };
}
