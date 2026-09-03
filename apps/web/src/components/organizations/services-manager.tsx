"use client";

import { useState, type FormEvent } from "react";
import type { ServiceItem } from "../../lib/organizations";

export function ServicesManager({
  organizationId,
  initialServices,
}: {
  organizationId: string;
  initialServices: ServiceItem[];
}) {
  const [services, setServices] = useState<ServiceItem[]>(initialServices);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/services`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          durationMinutes: Number(duration),
          price: price === "" ? null : Number(price),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create service.");
        return;
      }

      const data = (await res.json()) as { service: ServiceItem };
      setServices((prev) => [...prev, data.service]);
      setName("");
      setDuration("30");
      setPrice("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(service: ServiceItem) {
    setPendingId(service.id);
    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/services/${service.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !service.active }),
      });
      if (res.ok) {
        const data = (await res.json()) as { service: ServiceItem };
        setServices((prev) => prev.map((s) => (s.id === service.id ? data.service : s)));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(serviceId: string) {
    setPendingId(serviceId);
    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/services/${serviceId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setServices((prev) => prev.filter((s) => s.id !== serviceId));
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Services</h2>

      {services.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">No services yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {service.name} — {service.durationMinutes} min
                {service.price ? ` — $${service.price}` : ""}
                {!service.active && " (inactive)"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleActive(service)}
                  disabled={pendingId === service.id}
                  className="rounded border border-black/[.15] px-2 py-1 text-xs disabled:opacity-50 dark:border-white/[.2]"
                >
                  {service.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(service.id)}
                  disabled={pendingId === service.id}
                  className="rounded border border-red-600/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Service name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Duration (min)
          <input
            type="number"
            required
            min={1}
            max={1440}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-28 rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Price (optional)
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {submitting ? "Adding..." : "Add service"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
