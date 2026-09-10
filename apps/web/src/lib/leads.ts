import { cookies } from "next/headers";
import { getApiUrl } from "./session";

export type LeadStatus = "new" | "contacted" | "closed";

export interface Lead {
  id: string;
  organizationId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  intent: string | null;
  notes: string | null;
  callSid: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

async function cookieHeader(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const header = cookieStore.toString();
  return header ? { cookie: header } : {};
}

export async function listLeads(organizationId: string): Promise<Lead[]> {
  const res = await fetch(
    `${getApiUrl()}/organizations/${organizationId}/leads`,
    {
      headers: await cookieHeader(),
      cache: "no-store",
    },
  );

  if (!res.ok) return [];

  const data = (await res.json()) as { leads: Lead[] };
  return data.leads;
}
