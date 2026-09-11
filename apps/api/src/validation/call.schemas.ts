import { z } from "zod";

/**
 * Internal-endpoint-only (services/voice-agent's call-recording write at
 * session end -- see the approved M12 Step 5 plan). Metadata only: no
 * transcript, recording, conversation content, summary, or analytics field
 * exists here or anywhere else on the calls table (see db/schema.ts's own
 * comment on the calls table). organizationId is deliberately absent --
 * it always comes from the already-authenticated route/token context,
 * never the request body, same discipline as createLeadSchema/
 * createAppointmentSchema. All four fields are required: this is a single,
 * complete write at call end, not a partial/creatable-then-updatable
 * record, so there is no optional field to fill in later.
 */
export const recordCallSchema = z.object({
  callSid: z.string().trim().min(1).max(100),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  disposition: z.enum(["completed", "failed", "abandoned"]),
});

export type RecordCallInput = z.infer<typeof recordCallSchema>;
