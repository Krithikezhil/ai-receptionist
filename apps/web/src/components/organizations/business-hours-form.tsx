"use client";

import { useState } from "react";
import type { BusinessHoursEntry } from "../../lib/organizations";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayRow {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

function buildInitialRows(initialHours: BusinessHoursEntry[]): DayRow[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const existing = initialHours.find((h) => h.dayOfWeek === dayOfWeek);
    return {
      dayOfWeek,
      isOpen: existing?.isOpen ?? false,
      openTime: existing?.openTime ?? "09:00",
      closeTime: existing?.closeTime ?? "17:00",
    };
  });
}

export function BusinessHoursForm({
  organizationId,
  initialHours,
}: {
  organizationId: string;
  initialHours: BusinessHoursEntry[];
}) {
  const [rows, setRows] = useState<DayRow[]>(() => buildInitialRows(initialHours));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function updateDay(dayOfWeek: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setStatus("saving");
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const payload = rows.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        isOpen: r.isOpen,
        openTime: r.isOpen ? r.openTime : null,
        closeTime: r.isOpen ? r.closeTime : null,
      }));

      const res = await fetch(`${apiUrl}/organizations/${organizationId}/business-hours`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save business hours.");
        setStatus("error");
        return;
      }

      setStatus("saved");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Business hours</h2>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.dayOfWeek} className="flex flex-wrap items-center gap-3">
            <label className="flex w-32 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={row.isOpen}
                onChange={(e) => updateDay(row.dayOfWeek, { isOpen: e.target.checked })}
              />
              {DAY_NAMES[row.dayOfWeek]}
            </label>
            {row.isOpen ? (
              <>
                <input
                  type="time"
                  value={row.openTime}
                  onChange={(e) => updateDay(row.dayOfWeek, { openTime: e.target.value })}
                  className="rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm text-black dark:border-white/[.2] dark:text-zinc-50"
                />
                <span className="text-sm text-zinc-500">to</span>
                <input
                  type="time"
                  value={row.closeTime}
                  onChange={(e) => updateDay(row.dayOfWeek, { closeTime: e.target.value })}
                  className="rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm text-black dark:border-white/[.2] dark:text-zinc-50"
                />
              </>
            ) : (
              <span className="text-sm text-zinc-500 dark:text-zinc-500">Closed</span>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {status === "saved" && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={status === "saving"}
        className="w-fit rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {status === "saving" ? "Saving..." : "Save hours"}
      </button>
    </div>
  );
}
