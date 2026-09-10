"use client";

import { useMemo, useState } from "react";
import { cancelAppointment, type Appointment } from "../../lib/appointments-client";

const ACTIVE_STATUSES: Appointment["status"][] = ["scheduled", "confirmed"];

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function AppointmentsTable({
  organizationId,
  initialAppointments,
}: {
  organizationId: string;
  initialAppointments: Appointment[];
}) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const upcomingList: Appointment[] = [];
    const pastList: Appointment[] = [];
    for (const appointment of appointments) {
      const start = new Date(appointment.startTime);
      if (!Number.isNaN(start.getTime()) && start >= now) {
        upcomingList.push(appointment);
      } else {
        pastList.push(appointment);
      }
    }
    return { upcoming: upcomingList, past: pastList };
  }, [appointments]);

  async function handleCancel(appointment: Appointment) {
    setError(null);
    setPendingId(appointment.id);
    const previousAppointments = appointments;
    setAppointments((prev) =>
      prev.map((a) => (a.id === appointment.id ? { ...a, status: "cancelled" } : a)),
    );

    try {
      const updated = await cancelAppointment(organizationId, appointment.id);
      if (!updated) {
        setAppointments(previousAppointments);
        setError("Could not cancel the appointment. Please try again.");
        return;
      }
      setAppointments((prev) =>
        prev.map((a) => (a.id === appointment.id ? updated : a)),
      );
    } catch {
      setAppointments(previousAppointments);
      setError("Could not cancel the appointment. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  function renderAppointment(appointment: Appointment) {
    const canCancel = ACTIVE_STATUSES.includes(appointment.status);
    return (
      <li
        key={appointment.id}
        className="flex flex-col gap-2 rounded border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {appointment.customerName ?? "—"}
          </span>
          {canCancel && (
            <button
              type="button"
              onClick={() => handleCancel(appointment)}
              disabled={pendingId === appointment.id}
              className="rounded border border-red-600/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
          <span>When: {formatDateTime(appointment.startTime)}</span>
          <span>Status: {appointment.status}</span>
          {appointment.customerPhone && <span>Phone: {appointment.customerPhone}</span>}
          {appointment.customerEmail && <span>Email: {appointment.customerEmail}</span>}
        </div>
        {appointment.notes && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Notes: {appointment.notes}
          </p>
        )}
      </li>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        Appointments
      </h2>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {appointments.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          No appointments yet.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Upcoming
            </h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No upcoming appointments.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((appointment) => renderAppointment(appointment))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Past
            </h3>
            {past.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No past appointments.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {past.map((appointment) => renderAppointment(appointment))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
