import { cookies } from "next/headers";
import { getApiUrl } from "./session";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfile {
  id: string;
  organizationId: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessHoursEntry {
  id: string;
  organizationId: string;
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface ServiceItem {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeCategory = "faq" | "policy" | "service_info" | "custom";

export interface KnowledgeEntry {
  id: string;
  organizationId: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReceptionistConfig {
  id: string;
  organizationId: string;
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
  createdAt: string;
  updatedAt: string;
}

async function cookieHeader(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const header = cookieStore.toString();
  return header ? { cookie: header } : {};
}

/**
 * Server-side reads, forwarding the incoming request's cookies to the API
 * (same pattern as lib/session.ts). The API independently re-verifies
 * membership on every call — these helpers don't grant access on their
 * own, they just surface whatever the backend already decided.
 */
export async function listOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${getApiUrl()}/organizations`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { organizations: Organization[] };
  return data.organizations;
}

export async function getBusinessProfile(organizationId: string): Promise<BusinessProfile | null> {
  const res = await fetch(`${getApiUrl()}/organizations/${organizationId}/business-profile`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { businessProfile: BusinessProfile };
  return data.businessProfile;
}

export async function getBusinessHours(organizationId: string): Promise<BusinessHoursEntry[]> {
  const res = await fetch(`${getApiUrl()}/organizations/${organizationId}/business-hours`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { businessHours: BusinessHoursEntry[] };
  return data.businessHours;
}

export async function listServices(organizationId: string): Promise<ServiceItem[]> {
  const res = await fetch(`${getApiUrl()}/organizations/${organizationId}/services`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { services: ServiceItem[] };
  return data.services;
}

export async function listKnowledge(organizationId: string): Promise<KnowledgeEntry[]> {
  const res = await fetch(`${getApiUrl()}/organizations/${organizationId}/knowledge`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { knowledge: KnowledgeEntry[] };
  return data.knowledge;
}

export async function getReceptionistConfig(
  organizationId: string,
): Promise<ReceptionistConfig | null> {
  const res = await fetch(`${getApiUrl()}/organizations/${organizationId}/receptionist-config`, {
    headers: await cookieHeader(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { receptionistConfig: ReceptionistConfig };
  return data.receptionistConfig;
}
