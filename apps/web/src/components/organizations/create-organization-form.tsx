"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${apiUrl}/organizations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create organization.");
        return;
      }

      // Re-render the server-side dashboard page with the new organization.
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        Create your organization
      </h2>
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Business name
        <input
          type="text"
          required
          minLength={1}
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50"
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {submitting ? "Creating..." : "Create organization"}
      </button>
    </form>
  );
}
