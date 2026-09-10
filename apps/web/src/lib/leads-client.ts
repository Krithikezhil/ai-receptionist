import type { Lead, LeadStatus } from "./leads";

export type { Lead, LeadStatus };

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function updateLeadStatus(
  organizationId: string,
  leadId: string,
  status: LeadStatus,
): Promise<Lead | null> {
  const res = await fetch(
    `${apiUrl}/organizations/${organizationId}/leads/${leadId}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as { lead: Lead };
  return data.lead;
}

export async function deleteLead(
  organizationId: string,
  leadId: string,
): Promise<boolean> {
  const res = await fetch(
    `${apiUrl}/organizations/${organizationId}/leads/${leadId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );

  return res.ok;
}
