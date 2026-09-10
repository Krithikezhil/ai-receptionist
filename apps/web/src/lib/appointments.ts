import { cookies } from "next/headers";
import { getApiUrl } from "./session";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

export interface Appointment {
  id: string;
  organizationId: string;
  serviceId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  callSid: string | null;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function cookieHeader(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const header = cookieStore.toString();
  return header ? { cookie: header } : {};
}

export async function listAppointments(
  organizationId: string,
): Promise<Appointment[]> {
  const res = await fetch(
    `${getApiUrl()}/organizations/${organizationId}/appointments`,
    {
      headers: await cookieHeader(),
      cache: "no-store",
    },
  );

  if (!res.ok) return [];

  const data = (await res.json()) as {
    appointments: Appointment[];
  };
  return data.appointments;
}
