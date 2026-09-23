import { getDb } from "../db/client.js";
import { createDrizzleAppointmentRepository } from "./drizzle/appointment.repository.js";
import { createDrizzleBusinessHoursRepository } from "./drizzle/business-hours.repository.js";
import { createDrizzleBusinessProfileRepository } from "./drizzle/business-profile.repository.js";
import { createDrizzleOrganizationCalendarConnectionRepository } from "./drizzle/calendar-connection.repository.js";
import { createDrizzleCallRepository } from "./drizzle/call.repository.js";
import { createDrizzleCallUsageReportRepository } from "./drizzle/call-usage-report.repository.js";
import { createDrizzleKnowledgeChunkRepository } from "./drizzle/knowledge-chunk.repository.js";
import { createDrizzleKnowledgeRepository } from "./drizzle/knowledge.repository.js";
import { createDrizzleLeadRepository } from "./drizzle/lead.repository.js";
import { createDrizzleMembershipRepository } from "./drizzle/membership.repository.js";
import { createDrizzleOrganizationPhoneNumberRepository } from "./drizzle/organization-phone-number.repository.js";
import { createDrizzleOrganizationServiceCredentialRepository } from "./drizzle/organization-service-credential.repository.js";
import { createDrizzleOrganizationSubscriptionRepository } from "./drizzle/organization-subscription.repository.js";
import { createDrizzleOrganizationRepository } from "./drizzle/organization.repository.js";
import { createDrizzleReceptionistConfigRepository } from "./drizzle/receptionist-config.repository.js";
import { createDrizzleServiceRepository } from "./drizzle/service.repository.js";
import { createDrizzleSessionRepository } from "./drizzle/session.repository.js";
import { createDrizzleSmsNotificationRepository } from "./drizzle/sms-notification.repository.js";
import { createDrizzleSmsOptOutRepository } from "./drizzle/sms-opt-out.repository.js";
import { createDrizzleStripeWebhookEventRepository } from "./drizzle/stripe-webhook-event.repository.js";
import { createDrizzleUnitOfWork } from "./drizzle/unit-of-work.js";
import { createDrizzleUserRepository } from "./drizzle/user.repository.js";
import type { AppointmentRepository } from "./appointment-types.js";
import type { OrganizationCalendarConnectionRepository } from "./calendar-connection-types.js";
import type { CallRepository } from "./call-types.js";
import type { CallUsageReportRepository } from "./call-usage-report-types.js";
import type { KnowledgeChunkRepository } from "./knowledge-chunk-types.js";
import type { KnowledgeRepository } from "./knowledge-types.js";
import type { LeadRepository } from "./lead-types.js";
import type { OrganizationPhoneNumberRepository } from "./organization-phone-number-types.js";
import type { OrganizationServiceCredentialRepository } from "./organization-service-credential-types.js";
import type { OrganizationSubscriptionRepository } from "./organization-subscription-types.js";
import type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
  ServiceRepository,
} from "./organization-types.js";
import type { ReceptionistConfigRepository } from "./receptionist-config-types.js";
import type { SmsNotificationRepository } from "./sms-notification-types.js";
import type { SmsOptOutRepository } from "./sms-opt-out-types.js";
import type { StripeWebhookEventRepository } from "./stripe-webhook-event-types.js";
import type { SessionRepository, UserRepository } from "./types.js";
import type { UnitOfWork } from "./unit-of-work.js";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  businessProfiles: BusinessProfileRepository;
  businessHours: BusinessHoursRepository;
  services: ServiceRepository;
  knowledge: KnowledgeRepository;
  knowledgeChunks: KnowledgeChunkRepository;
  leads: LeadRepository;
  receptionistConfigs: ReceptionistConfigRepository;
  organizationServiceCredentials: OrganizationServiceCredentialRepository;
  organizationSubscriptions: OrganizationSubscriptionRepository;
  organizationPhoneNumbers: OrganizationPhoneNumberRepository;
  appointments: AppointmentRepository;
  organizationCalendarConnections: OrganizationCalendarConnectionRepository;
  calls: CallRepository;
  callUsageReports: CallUsageReportRepository;
  smsNotifications: SmsNotificationRepository;
  smsOptOuts: SmsOptOutRepository;
  stripeWebhookEvents: StripeWebhookEventRepository;
  unitOfWork: UnitOfWork;
}

export function createRepositories(): Repositories {
  const db = getDb();
  return {
    users: createDrizzleUserRepository(db),
    sessions: createDrizzleSessionRepository(db),
    organizations: createDrizzleOrganizationRepository(db),
    memberships: createDrizzleMembershipRepository(db),
    businessProfiles: createDrizzleBusinessProfileRepository(db),
    businessHours: createDrizzleBusinessHoursRepository(db),
    services: createDrizzleServiceRepository(db),
    knowledge: createDrizzleKnowledgeRepository(db),
    knowledgeChunks: createDrizzleKnowledgeChunkRepository(db),
    leads: createDrizzleLeadRepository(db),
    receptionistConfigs: createDrizzleReceptionistConfigRepository(db),
    organizationServiceCredentials: createDrizzleOrganizationServiceCredentialRepository(db),
    organizationSubscriptions: createDrizzleOrganizationSubscriptionRepository(db),
    organizationPhoneNumbers: createDrizzleOrganizationPhoneNumberRepository(db),
    appointments: createDrizzleAppointmentRepository(db),
    organizationCalendarConnections: createDrizzleOrganizationCalendarConnectionRepository(db),
    calls: createDrizzleCallRepository(db),
    callUsageReports: createDrizzleCallUsageReportRepository(db),
    smsNotifications: createDrizzleSmsNotificationRepository(db),
    smsOptOuts: createDrizzleSmsOptOutRepository(db),
    stripeWebhookEvents: createDrizzleStripeWebhookEventRepository(db),
    unitOfWork: createDrizzleUnitOfWork(db),
  };
}

export type { SessionRepository, UserRepository } from "./types.js";
export type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
  ServiceRepository,
} from "./organization-types.js";
export type { KnowledgeChunkRepository } from "./knowledge-chunk-types.js";
export type { KnowledgeRepository } from "./knowledge-types.js";
export type { LeadRepository } from "./lead-types.js";
export type { OrganizationServiceCredentialRepository } from "./organization-service-credential-types.js";
export type { OrganizationSubscriptionRepository } from "./organization-subscription-types.js";
export type { OrganizationPhoneNumberRepository } from "./organization-phone-number-types.js";
export type { ReceptionistConfigRepository } from "./receptionist-config-types.js";
export type { AppointmentRepository } from "./appointment-types.js";
export type { OrganizationCalendarConnectionRepository } from "./calendar-connection-types.js";
export type { SmsNotificationRepository } from "./sms-notification-types.js";
export type { CallRepository } from "./call-types.js";
export type { CallUsageReportRepository } from "./call-usage-report-types.js";
export type { SmsOptOutRepository } from "./sms-opt-out-types.js";
export type { StripeWebhookEventRepository } from "./stripe-webhook-event-types.js";
export type { UnitOfWork } from "./unit-of-work.js";
