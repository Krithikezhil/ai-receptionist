"use client";

import { useState, type FormEvent } from "react";
import type { ReceptionistConfig } from "../../lib/organizations";

const inputClass =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50";

export function ReceptionistConfigForm({
  organizationId,
  initialConfig,
}: {
  organizationId: string;
  initialConfig: ReceptionistConfig | null;
}) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
  const [displayName, setDisplayName] = useState(initialConfig?.displayName ?? "AI Receptionist");
  const [greeting, setGreeting] = useState(initialConfig?.greeting ?? "");
  const [tone, setTone] = useState(initialConfig?.tone ?? "");
  const [instructions, setInstructions] = useState(initialConfig?.instructions ?? "");
  const [fallbackMessage, setFallbackMessage] = useState(initialConfig?.fallbackMessage ?? "");
  const [afterHoursMessage, setAfterHoursMessage] = useState(
    initialConfig?.afterHoursMessage ?? "",
  );
  const [callTransferEnabled, setCallTransferEnabled] = useState(
    initialConfig?.callTransferEnabled ?? false,
  );
  const [callTransferPhone, setCallTransferPhone] = useState(
    initialConfig?.callTransferPhone ?? "",
  );
  const [language, setLanguage] = useState(initialConfig?.language ?? "en");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/receptionist-config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          displayName,
          greeting,
          tone,
          instructions,
          fallbackMessage,
          afterHoursMessage,
          callTransferEnabled,
          callTransferPhone: callTransferPhone || null,
          language,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save receptionist configuration.");
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
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          AI receptionist configuration
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          This only stores configuration — it does not connect to a phone number or make the
          receptionist live yet.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Display name
          <input
            required
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Tone
          <input
            required
            maxLength={500}
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Greeting
        <textarea
          required
          maxLength={2000}
          rows={2}
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Additional instructions
        <textarea
          maxLength={5000}
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Fallback message (when it doesn&apos;t know the answer)
        <textarea
          required
          maxLength={2000}
          rows={2}
          value={fallbackMessage}
          onChange={(e) => setFallbackMessage(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        After-hours message
        <textarea
          required
          maxLength={2000}
          rows={2}
          value={afterHoursMessage}
          onChange={(e) => setAfterHoursMessage(e.target.value)}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Language
          <input
            required
            maxLength={35}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Call transfer phone (optional)
          <input
            maxLength={50}
            value={callTransferPhone}
            onChange={(e) => setCallTransferPhone(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={callTransferEnabled}
          onChange={(e) => setCallTransferEnabled(e.target.checked)}
        />
        Allow transferring to the phone number above
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {status === "saved" && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-fit rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {status === "saving" ? "Saving..." : "Save configuration"}
      </button>
    </form>
  );
}
