/**
 * The wire shape of the internal voice API (apps/api's
 * /internal/v1/organizations/:id/{runtime-context,knowledge}, consumed by
 * services/voice-agent). Defined once here so the API's controller/tests
 * and any future TypeScript consumer share a single canonical type instead
 * of an ad hoc object literal. Python does not import this directly, but it
 * is the type the API's response shape is written against. See
 * ARCHITECTURE.md "Internal voice API".
 */

export type KnowledgeCategory = "faq" | "policy" | "service_info" | "custom";

export interface RuntimeReceptionistConfig {
  enabled: boolean;
  displayName: string;
  greeting: string;
  tone: string;
  instructions: string;
  fallbackMessage: string;
  afterHoursMessage: string;
  callTransferEnabled: boolean;
  callTransferPhone: string | null;
  language: string;
}

export interface RuntimeBusinessProfile {
  businessName: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  timezone: string;
}

/** JS Date#getDay() convention: 0 = Sunday .. 6 = Saturday. */
export interface RuntimeBusinessHoursEntry {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface RuntimeServiceItem {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: string | null;
  active: boolean;
}

/**
 * GET /internal/v1/organizations/:id/runtime-context — everything the
 * voice-agent needs at session start, aggregated into one round trip.
 * businessProfile is typed nullable to match reality even though
 * organization creation always creates one (see organization.service.ts) —
 * this response shape doesn't assume that invariant holds forever.
 */
export interface RuntimeContext {
  organizationId: string;
  receptionistConfig: RuntimeReceptionistConfig;
  businessProfile: RuntimeBusinessProfile | null;
  businessHours: RuntimeBusinessHoursEntry[];
  services: RuntimeServiceItem[];
}

/**
 * GET /internal/v1/organizations/:id/knowledge — deliberately separate from
 * runtime-context and fetched on demand (not prefetched), since knowledge
 * can be large and needs live querying mid-conversation. Same
 * category/active/q filter semantics as the public knowledge endpoint —
 * substring match, no embeddings/RAG.
 */
export interface RuntimeKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  active: boolean;
}
