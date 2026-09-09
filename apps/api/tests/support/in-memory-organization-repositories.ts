import { randomUUID } from "node:crypto";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentOverlapError,
  type Appointment,
  type AppointmentRepository,
  type NewAppointment,
} from "../../src/repositories/appointment-types.js";
import type {
  NewOrganizationCalendarConnection,
  OrganizationCalendarConnection,
  OrganizationCalendarConnectionRepository,
} from "../../src/repositories/calendar-connection-types.js";
import type {
  KnowledgeChunk,
  KnowledgeChunkRepository,
  NewKnowledgeChunk,
} from "../../src/repositories/knowledge-chunk-types.js";
import type {
  KnowledgeEntry,
  KnowledgeRepository,
  NewKnowledgeEntry,
} from "../../src/repositories/knowledge-types.js";
import type { Lead, LeadRepository, NewLead } from "../../src/repositories/lead-types.js";
import type {
  BusinessHoursEntry,
  BusinessHoursRepository,
  BusinessProfile,
  BusinessProfileRepository,
  MembershipRepository,
  NewBusinessProfile,
  NewOrganization,
  NewOrganizationMembership,
  NewServiceItem,
  Organization,
  OrganizationMembership,
  OrganizationRepository,
  ServiceItem,
  ServiceRepository,
} from "../../src/repositories/organization-types.js";
import type {
  NewOrganizationPhoneNumber,
  OrganizationPhoneNumber,
  OrganizationPhoneNumberRepository,
} from "../../src/repositories/organization-phone-number-types.js";
import type {
  NewOrganizationServiceCredential,
  OrganizationServiceCredential,
  OrganizationServiceCredentialRepository,
} from "../../src/repositories/organization-service-credential-types.js";
import type {
  NewReceptionistConfiguration,
  ReceptionistConfigRepository,
  ReceptionistConfiguration,
} from "../../src/repositories/receptionist-config-types.js";
import {
  DuplicateSmsNotificationError,
  SmsNotificationEntityReferenceError,
  type NewSmsNotification,
  type SmsNotification,
  type SmsNotificationRepository,
  type SmsNotificationStatusUpdate,
} from "../../src/repositories/sms-notification-types.js";
import type { OrganizationCreationRepos, UnitOfWork } from "../../src/repositories/unit-of-work.js";

/**
 * Applies only the keys present with a non-undefined value — mirrors how a
 * real SQL UPDATE ... SET only touches columns actually named in the
 * statement. Needed because exactOptionalPropertyTypes makes a plain
 * `{ ...base, ...changes }` spread type-unsound when changes' optional
 * fields are typed `T | undefined`.
 */
type PartialUpdate<T> = { [K in keyof T]?: T[K] | undefined };

function applyDefined<T extends object>(base: T, changes: PartialUpdate<T>): T {
  const result: T = { ...base };
  for (const key of Object.keys(changes) as (keyof T)[]) {
    const value = changes[key];
    if (value !== undefined) {
      result[key] = value as T[typeof key];
    }
  }
  return result;
}

/**
 * Test doubles for the M3 repository interfaces — same role as
 * in-memory-repositories.ts from M2. Production code always uses the
 * Postgres/Drizzle implementations (src/repositories/drizzle/*).
 *
 * Organizations and memberships are created as a pair sharing one backing
 * store, since listForUser's join has to be simulated somewhere — this
 * keeps that simulation in one place instead of reaching into the other
 * repository's internals.
 */
export function createInMemoryOrganizationRepositories(): {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
} {
  const orgs = new Map<string, Organization>();
  const memberships: OrganizationMembership[] = [];

  const organizations: OrganizationRepository = {
    async create(newOrg: NewOrganization) {
      const now = new Date();
      const org: Organization = { id: randomUUID(), ...newOrg, createdAt: now, updatedAt: now };
      orgs.set(org.id, org);
      return org;
    },
    async findById(id) {
      return orgs.get(id);
    },
    async findBySlug(slug) {
      return [...orgs.values()].find((o) => o.slug === slug);
    },
    async listForUser(userId) {
      const orgIds = new Set(
        memberships.filter((m) => m.userId === userId).map((m) => m.organizationId),
      );
      return [...orgs.values()].filter((o) => orgIds.has(o.id));
    },
    async update(id, changes) {
      const existing = orgs.get(id);
      if (!existing) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      orgs.set(id, updated);
      return updated;
    },
  };

  const membershipRepo: MembershipRepository = {
    async create(newMembership: NewOrganizationMembership) {
      // Mirrors the real unique(organization_id, user_id) constraint from
      // the migration (see db/migrations) — a real Postgres insert would
      // throw a unique-violation here too.
      const duplicate = memberships.some(
        (m) =>
          m.organizationId === newMembership.organizationId && m.userId === newMembership.userId,
      );
      if (duplicate) {
        throw new Error(
          `Duplicate membership: user ${newMembership.userId} is already a member of organization ${newMembership.organizationId}`,
        );
      }

      const membership: OrganizationMembership = {
        id: randomUUID(),
        ...newMembership,
        createdAt: new Date(),
      };
      memberships.push(membership);
      return membership;
    },
    async findByOrgAndUser(organizationId, userId) {
      return memberships.find((m) => m.organizationId === organizationId && m.userId === userId);
    },
    async listByUser(userId) {
      return memberships.filter((m) => m.userId === userId);
    },
  };

  return { organizations, memberships: membershipRepo };
}

export function createInMemoryBusinessProfileRepository(): BusinessProfileRepository {
  const profiles = new Map<string, BusinessProfile>();

  return {
    async findByOrganizationId(organizationId) {
      return [...profiles.values()].find((p) => p.organizationId === organizationId);
    },
    async create(newProfile: NewBusinessProfile) {
      const now = new Date();
      const profile: BusinessProfile = {
        id: randomUUID(),
        organizationId: newProfile.organizationId,
        businessName: newProfile.businessName,
        description: newProfile.description ?? null,
        phone: newProfile.phone ?? null,
        email: newProfile.email ?? null,
        website: newProfile.website ?? null,
        address: newProfile.address ?? null,
        timezone: newProfile.timezone ?? "UTC",
        createdAt: now,
        updatedAt: now,
      };
      profiles.set(profile.id, profile);
      return profile;
    },
    async update(organizationId, changes) {
      const existing = [...profiles.values()].find((p) => p.organizationId === organizationId);
      if (!existing) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      profiles.set(existing.id, updated);
      return updated;
    },
  };
}

export function createInMemoryBusinessHoursRepository(): BusinessHoursRepository {
  let rows: BusinessHoursEntry[] = [];

  return {
    async listByOrganizationId(organizationId) {
      return rows.filter((r) => r.organizationId === organizationId);
    },
    async replaceAll(organizationId, entries) {
      rows = rows.filter((r) => r.organizationId !== organizationId);
      const created = entries.map((e) => ({ id: randomUUID(), organizationId, ...e }));
      rows.push(...created);
      return created;
    },
  };
}

export function createInMemoryServiceRepository(): ServiceRepository {
  const items = new Map<string, ServiceItem>();

  return {
    async listByOrganizationId(organizationId) {
      return [...items.values()].filter((s) => s.organizationId === organizationId);
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(newService: NewServiceItem) {
      const now = new Date();
      const item: ServiceItem = {
        id: randomUUID(),
        organizationId: newService.organizationId,
        name: newService.name,
        description: newService.description ?? null,
        durationMinutes: newService.durationMinutes,
        price: newService.price ?? null,
        active: newService.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      items.set(item.id, item);
      return item;
    },
    async update(id, organizationId, changes) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, ...changes, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return false;
      items.delete(id);
      return true;
    },
  };
}

export function createInMemoryLeadRepository(): LeadRepository {
  const items = new Map<string, Lead>();

  return {
    async listByOrganizationId(organizationId) {
      return [...items.values()].filter((l) => l.organizationId === organizationId);
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(newLead: NewLead) {
      const now = new Date();
      const lead: Lead = {
        id: randomUUID(),
        organizationId: newLead.organizationId,
        contactName: newLead.contactName ?? null,
        contactPhone: newLead.contactPhone ?? null,
        contactEmail: newLead.contactEmail ?? null,
        intent: newLead.intent ?? null,
        notes: newLead.notes ?? null,
        callSid: newLead.callSid ?? null,
        status: newLead.status ?? "new",
        createdAt: now,
        updatedAt: now,
      };
      items.set(lead.id, lead);
      return lead;
    },
    async updateStatus(id, organizationId, changes) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, ...changes, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return false;
      items.delete(id);
      return true;
    },
  };
}

export function createInMemoryKnowledgeRepository(): KnowledgeRepository {
  const items = new Map<string, KnowledgeEntry>();

  return {
    async listByOrganizationId(organizationId, filter) {
      let results = [...items.values()].filter((e) => e.organizationId === organizationId);
      if (filter?.category) results = results.filter((e) => e.category === filter.category);
      if (filter?.active !== undefined) results = results.filter((e) => e.active === filter.active);
      if (filter?.q) {
        const needle = filter.q.toLowerCase();
        results = results.filter(
          (e) => e.title.toLowerCase().includes(needle) || e.content.toLowerCase().includes(needle),
        );
      }
      return results;
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(newEntry: NewKnowledgeEntry) {
      const now = new Date();
      const entry: KnowledgeEntry = {
        id: randomUUID(),
        organizationId: newEntry.organizationId,
        title: newEntry.title,
        content: newEntry.content,
        category: newEntry.category ?? "custom",
        active: newEntry.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      items.set(entry.id, entry);
      return entry;
    },
    async update(id, organizationId, changes) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      items.set(id, updated);
      return updated;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return false;
      items.delete(id);
      return true;
    },
  };
}

/**
 * M8: takes the already-constructed in-memory KnowledgeRepository as an
 * explicit, visible parameter -- used only to verify (mirroring the real
 * Drizzle repository's own application-level check, see
 * drizzle/knowledge-chunk.repository.ts) that a knowledgeEntryId actually
 * belongs to the supplied organizationId before "persisting" chunks for it.
 * Not used for cascade-delete: knowledge.service.ts's deleteKnowledge calls
 * deleteByKnowledgeEntryId explicitly instead of relying on any fake-only
 * cascade mechanism (the real DB's ON DELETE CASCADE from Step 1 is not
 * modeled here at all -- that guarantee is the database's, not this
 * double's, to provide).
 */
export function createInMemoryKnowledgeChunkRepository(
  knowledgeRepo: KnowledgeRepository,
): KnowledgeChunkRepository {
  const chunks = new Map<string, KnowledgeChunk>();

  function removeExisting(knowledgeEntryId: string, organizationId: string): void {
    for (const [id, chunk] of chunks) {
      if (chunk.knowledgeEntryId === knowledgeEntryId && chunk.organizationId === organizationId) {
        chunks.delete(id);
      }
    }
  }

  return {
    async replaceChunksForKnowledgeEntry(knowledgeEntryId, organizationId, newChunks) {
      const entry = await knowledgeRepo.findByIdAndOrganizationId(knowledgeEntryId, organizationId);
      if (!entry) {
        throw new Error(
          `Cannot persist chunks for knowledge entry ${knowledgeEntryId}: it does not belong to organization ${organizationId}.`,
        );
      }

      removeExisting(knowledgeEntryId, organizationId);

      const created: KnowledgeChunk[] = newChunks.map((chunk: NewKnowledgeChunk) => ({
        id: randomUUID(),
        knowledgeEntryId,
        organizationId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding,
        createdAt: new Date(),
      }));
      for (const chunk of created) chunks.set(chunk.id, chunk);
      return created;
    },

    async listByKnowledgeEntryId(knowledgeEntryId, organizationId) {
      return [...chunks.values()].filter(
        (c) => c.knowledgeEntryId === knowledgeEntryId && c.organizationId === organizationId,
      );
    },

    async deleteByKnowledgeEntryId(knowledgeEntryId, organizationId) {
      removeExisting(knowledgeEntryId, organizationId);
    },

    async listByOrganizationId(organizationId) {
      return [...chunks.values()].filter((c) => c.organizationId === organizationId);
    },
  };
}

const DEFAULT_RECEPTIONIST_CONFIG = {
  displayName: "AI Receptionist",
  greeting: "Thank you for calling. How can I help you today?",
  tone: "friendly and professional",
  instructions: "",
  fallbackMessage:
    "I'm sorry, I don't have that information right now. Let me have someone follow up with you.",
  afterHoursMessage:
    "Thanks for calling. We're currently closed — please leave a message and we'll get back to you.",
  language: "en",
} as const;

export function createInMemoryReceptionistConfigRepository(): ReceptionistConfigRepository {
  const configs = new Map<string, ReceptionistConfiguration>();

  return {
    async findByOrganizationId(organizationId) {
      return [...configs.values()].find((c) => c.organizationId === organizationId);
    },
    async create(newConfig: NewReceptionistConfiguration) {
      const now = new Date();
      const config: ReceptionistConfiguration = {
        id: randomUUID(),
        organizationId: newConfig.organizationId,
        // enabled is never taken from the caller, matching the Drizzle
        // implementation — organization creation must never activate it.
        enabled: false,
        displayName: newConfig.displayName ?? DEFAULT_RECEPTIONIST_CONFIG.displayName,
        greeting: newConfig.greeting ?? DEFAULT_RECEPTIONIST_CONFIG.greeting,
        tone: newConfig.tone ?? DEFAULT_RECEPTIONIST_CONFIG.tone,
        instructions: newConfig.instructions ?? DEFAULT_RECEPTIONIST_CONFIG.instructions,
        fallbackMessage: newConfig.fallbackMessage ?? DEFAULT_RECEPTIONIST_CONFIG.fallbackMessage,
        afterHoursMessage:
          newConfig.afterHoursMessage ?? DEFAULT_RECEPTIONIST_CONFIG.afterHoursMessage,
        callTransferEnabled: false,
        callTransferPhone: newConfig.callTransferPhone ?? null,
        language: newConfig.language ?? DEFAULT_RECEPTIONIST_CONFIG.language,
        createdAt: now,
        updatedAt: now,
      };
      configs.set(config.id, config);
      return config;
    },
    async update(organizationId, changes) {
      const existing = [...configs.values()].find((c) => c.organizationId === organizationId);
      if (!existing) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      configs.set(existing.id, updated);
      return updated;
    },
  };
}

export function createInMemoryOrganizationServiceCredentialRepository(): OrganizationServiceCredentialRepository {
  const credentials = new Map<string, OrganizationServiceCredential>();

  return {
    async create(newCredential: NewOrganizationServiceCredential) {
      const credential: OrganizationServiceCredential = {
        ...newCredential,
        createdAt: new Date(),
      };
      credentials.set(credential.organizationId, credential);
      return credential;
    },
    async findByOrganizationId(organizationId) {
      return credentials.get(organizationId);
    },
  };
}

export function createInMemoryOrganizationPhoneNumberRepository(): OrganizationPhoneNumberRepository {
  const rows = new Map<string, OrganizationPhoneNumber>();

  return {
    async listByOrganizationId(organizationId) {
      return [...rows.values()].filter((r) => r.organizationId === organizationId);
    },
    async findByPhoneNumber(phoneNumber) {
      return [...rows.values()].find((r) => r.phoneNumber === phoneNumber);
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const row = rows.get(id);
      return row && row.organizationId === organizationId ? row : undefined;
    },
    async create(newPhoneNumber: NewOrganizationPhoneNumber) {
      const row: OrganizationPhoneNumber = {
        id: randomUUID(),
        organizationId: newPhoneNumber.organizationId,
        phoneNumber: newPhoneNumber.phoneNumber,
        createdAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const row = rows.get(id);
      if (row && row.organizationId === organizationId) {
        rows.delete(id);
      }
    },
  };
}

export function createInMemoryUnitOfWork(repos: OrganizationCreationRepos): UnitOfWork {
  return {
    // No real transaction semantics needed for a single-threaded test double.
    async run(fn) {
      return fn(repos);
    },
  };
}

export function createInMemoryAppointmentRepository(): AppointmentRepository {
  const items = new Map<string, Appointment>();

  function overlapsActiveAppointment(
    organizationId: string,
    startTime: Date,
    endTime: Date,
  ): boolean {
    for (const item of items.values()) {
      if (item.organizationId !== organizationId) continue;
      if (!ACTIVE_APPOINTMENT_STATUSES.includes(item.status)) continue;
      if (startTime < item.endTime && item.startTime < endTime) return true;
    }
    return false;
  }

  return {
    async listByOrganizationId(organizationId) {
      return [...items.values()].filter((a) => a.organizationId === organizationId);
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(newAppointment: NewAppointment) {
      // Mirrors the real `appointments_no_overlap` PostgreSQL EXCLUDE
      // constraint (see db/schema.ts, migrations/0007_kind_kingpin.sql) --
      // a real Postgres insert would throw the same AppointmentOverlapError
      // here too (translated from error code 23P01 in
      // drizzle/appointment.repository.ts).
      if (
        overlapsActiveAppointment(
          newAppointment.organizationId,
          newAppointment.startTime,
          newAppointment.endTime,
        )
      ) {
        throw new AppointmentOverlapError(
          "Requested appointment time overlaps an existing appointment for this organization.",
        );
      }

      const now = new Date();
      const appointment: Appointment = {
        id: randomUUID(),
        organizationId: newAppointment.organizationId,
        serviceId: newAppointment.serviceId,
        customerName: newAppointment.customerName ?? null,
        customerPhone: newAppointment.customerPhone ?? null,
        customerEmail: newAppointment.customerEmail ?? null,
        notes: newAppointment.notes ?? null,
        startTime: newAppointment.startTime,
        endTime: newAppointment.endTime,
        status: newAppointment.status ?? "scheduled",
        callSid: newAppointment.callSid ?? null,
        googleEventId: newAppointment.googleEventId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      items.set(appointment.id, appointment);
      return appointment;
    },
    async updateGoogleEventId(id, organizationId, googleEventId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, googleEventId, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
    async updateStatus(id, organizationId, changes) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, ...changes, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return false;
      items.delete(id);
      return true;
    },
  };
}

export function createInMemoryOrganizationCalendarConnectionRepository(): OrganizationCalendarConnectionRepository {
  const connections = new Map<string, OrganizationCalendarConnection>();

  return {
    async findByOrganizationId(organizationId) {
      return connections.get(organizationId);
    },
    async upsert(newConnection: NewOrganizationCalendarConnection) {
      const existing = connections.get(newConnection.organizationId);
      const now = new Date();
      const connection: OrganizationCalendarConnection = {
        organizationId: newConnection.organizationId,
        googleAccountEmail: newConnection.googleAccountEmail,
        refreshTokenCiphertext: newConnection.refreshTokenCiphertext,
        status: newConnection.status ?? "connected",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      connections.set(connection.organizationId, connection);
      return connection;
    },
    async updateStatus(organizationId, changes) {
      const existing = connections.get(organizationId);
      if (!existing) return undefined;
      const updated = { ...existing, ...changes, updatedAt: new Date() };
      connections.set(organizationId, updated);
      return updated;
    },
    async deleteByOrganizationId(organizationId) {
      return connections.delete(organizationId);
    },
  };
}

export function createInMemorySmsNotificationRepository(): SmsNotificationRepository {
  const items = new Map<string, SmsNotification>();

  function hasDuplicate(notification: NewSmsNotification): boolean {
    for (const item of items.values()) {
      if (item.notificationType !== notification.notificationType) continue;
      if (
        notification.appointmentId !== undefined &&
        item.appointmentId === notification.appointmentId
      ) {
        return true;
      }
      if (notification.leadId !== undefined && item.leadId === notification.leadId) {
        return true;
      }
    }
    return false;
  }

  return {
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(notification: NewSmsNotification) {
      // Mirrors the real sms_notifications_exactly_one_entity CHECK
      // constraint and the two partial unique indexes (see db/schema.ts)
      // -- a real Postgres insert would throw the same typed errors here
      // too (translated in drizzle/sms-notification.repository.ts).
      // NewSmsNotification's XOR shape only prevents this at compile
      // time for well-typed callers; there is no database here to
      // enforce it at runtime, so this check is not optional.
      const hasAppointment = notification.appointmentId !== undefined;
      const hasLead = notification.leadId !== undefined;
      if (hasAppointment === hasLead) {
        throw new SmsNotificationEntityReferenceError(
          "A notification must reference exactly one appointment or lead, not both or neither.",
        );
      }
      if (hasDuplicate(notification)) {
        throw new DuplicateSmsNotificationError(
          "A notification of this type already exists for this appointment or lead.",
        );
      }

      const now = new Date();
      const item: SmsNotification = {
        id: randomUUID(),
        organizationId: notification.organizationId,
        notificationType: notification.notificationType,
        appointmentId: notification.appointmentId ?? null,
        leadId: notification.leadId ?? null,
        destinationPhone: notification.destinationPhone,
        status: "pending",
        providerMessageSid: null,
        attemptCount: 0,
        claimedAt: null,
        lastAttemptedAt: null,
        nextAttemptAt: now,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      };
      items.set(item.id, item);
      return item;
    },
    async claimDue(limit) {
      // Single-threaded test double -- no real concurrent callers exist,
      // so there is nothing here to race with. This mirrors the
      // reasoning already documented on UnitOfWork's in-memory
      // implementation (see unit-of-work.ts): the Drizzle implementation
      // is what actually has to be concurrency-safe (see
      // drizzle/sms-notification.repository.ts's FOR UPDATE SKIP LOCKED
      // claim); this double only needs to reproduce the same observable
      // *result* -- pending+due rows, oldest-due-first, up to `limit`,
      // transitioned to processing with claimedAt/lastAttemptedAt set
      // and attemptCount incremented.
      const now = new Date();
      const due = [...items.values()]
        .filter((item) => item.status === "pending" && item.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        .slice(0, limit);

      const claimed: SmsNotification[] = [];
      for (const item of due) {
        const updated: SmsNotification = {
          ...item,
          status: "processing",
          claimedAt: now,
          lastAttemptedAt: now,
          attemptCount: item.attemptCount + 1,
          updatedAt: now,
        };
        items.set(item.id, updated);
        claimed.push(updated);
      }
      return claimed;
    },
    async updateStatus(id, organizationId, update: SmsNotificationStatusUpdate) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, ...update, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
  };
}
