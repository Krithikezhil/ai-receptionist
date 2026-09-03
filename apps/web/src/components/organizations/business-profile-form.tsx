"use client";

import { useState, type FormEvent } from "react";
import type { BusinessProfile } from "../../lib/organizations";

const inputClass =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50";

export function BusinessProfileForm({
  organizationId,
  initialProfile,
}: {
  organizationId: string;
  initialProfile: BusinessProfile | null;
}) {
  const [businessName, setBusinessName] = useState(initialProfile?.businessName ?? "");
  const [description, setDescription] = useState(initialProfile?.description ?? "");
  const [phone, setPhone] = useState(initialProfile?.phone ?? "");
  const [email, setEmail] = useState(initialProfile?.email ?? "");
  const [website, setWebsite] = useState(initialProfile?.website ?? "");
  const [address, setAddress] = useState(initialProfile?.address ?? "");
  const [timezone, setTimezone] = useState(initialProfile?.timezone ?? "UTC");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/business-profile`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          description: description || null,
          phone: phone || null,
          email: email || null,
          website: website || null,
          address: address || null,
          timezone,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save business profile.");
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
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Business profile</h2>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Business name
        <input
          required
          maxLength={200}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Description
        <textarea
          maxLength={2000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Phone
          <input
            maxLength={50}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Website
          <input
            maxLength={500}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Timezone
          <input
            maxLength={100}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Address
        <input
          maxLength={500}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={inputClass}
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {status === "saved" && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-fit rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {status === "saving" ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
