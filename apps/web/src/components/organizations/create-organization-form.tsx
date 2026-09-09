"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface OneTimeCredential {
  token: string;
  organizationName: string;
}

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Held only in React state -- never localStorage/sessionStorage/cookies/
  // URL, never logged, never sent anywhere after being received. It is
  // gone the moment this component unmounts (navigation, refresh, or the
  // explicit dismiss below), because that is the only place it lives.
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

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

      const data = (await res.json()) as { serviceCredential?: { token?: string } };
      const token = data.serviceCredential?.token;

      if (typeof token === "string" && token.length > 0) {
        // Deliberately NOT calling router.refresh() yet -- this component
        // is only rendered by the dashboard page while the user has zero
        // organizations. Refreshing immediately would re-run that server
        // check, find the new organization, and unmount this component
        // (and its one-time credential) before the user could see it.
        // router.refresh() is deferred to handleDismiss() below instead.
        setCredential({ token, organizationName: name });
      } else {
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.token);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function handleDismiss() {
    setCredential(null);
    setRevealed(false);
    setCopyStatus("idle");
    // Re-render the server-side dashboard page with the new organization,
    // now that the one-time credential has been acknowledged.
    router.refresh();
  }

  if (credential) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Service credential for &quot;{credential.organizationName}&quot;
        </h2>
        <p className="text-sm text-red-600 dark:text-red-400">
          This credential is shown only once and cannot be retrieved again. Copy it now and store
          it somewhere safe before leaving this page.
        </p>

        <div className="flex flex-col gap-2">
          <code className="break-all rounded border border-black/[.15] bg-transparent px-3 py-2 text-sm text-black dark:border-white/[.2] dark:text-zinc-50">
            {revealed ? credential.token : "••••••••••••••••••••••••••••"}
          </code>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2]"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Copy
            </button>
          </div>

          {copyStatus === "copied" && (
            <p className="text-sm text-green-600 dark:text-green-400">Copied to clipboard.</p>
          )}
          {copyStatus === "failed" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Could not copy automatically. Select the value above and copy it manually.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="w-fit rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          I&apos;ve saved it — continue
        </button>
      </div>
    );
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
