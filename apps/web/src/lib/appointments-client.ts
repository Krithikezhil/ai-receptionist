import type { Appointment } from "./appointments";

export type { Appointment };

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function cancelAppointment(
  organizationId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const res = await fetch(
    `${apiUrl}/organizations/${organizationId}/appointments/${appointmentId}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as {
    appointment: Appointment;
  };
  return data.appointment;
}
