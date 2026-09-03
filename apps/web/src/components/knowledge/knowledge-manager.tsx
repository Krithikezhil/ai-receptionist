"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { KnowledgeCategory, KnowledgeEntry } from "../../lib/organizations";

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  faq: "FAQ",
  policy: "Policy",
  service_info: "Service info",
  custom: "Custom",
};

const inputClass =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50";

export function KnowledgeManager({
  organizationId,
  initialEntries,
}: {
  organizationId: string;
  initialEntries: KnowledgeEntry[];
}) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>(initialEntries);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>("custom");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeCategory | "all">("all");
  const [search, setSearch] = useState("");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (categoryFilter !== "all" && entry.category !== categoryFilter) return false;
      if (
        needle &&
        !entry.title.toLowerCase().includes(needle) &&
        !entry.content.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, categoryFilter, search]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/knowledge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, category }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create knowledge entry.");
        return;
      }

      const data = (await res.json()) as { knowledge: KnowledgeEntry };
      setEntries((prev) => [...prev, data.knowledge]);
      setTitle("");
      setContent("");
      setCategory("custom");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(entry: KnowledgeEntry) {
    setPendingId(entry.id);
    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/knowledge/${entry.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !entry.active }),
      });
      if (res.ok) {
        const data = (await res.json()) as { knowledge: KnowledgeEntry };
        setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.knowledge : e)));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(entryId: string) {
    setPendingId(entryId);
    try {
      const res = await fetch(`${apiUrl}/organizations/${organizationId}/knowledge/${entryId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Knowledge base</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Information the future AI receptionist will be able to draw on. Not connected to any live AI
        yet — this only stores the content.
      </p>

      <div className="flex flex-wrap gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as KnowledgeCategory | "all")}
          className={inputClass}
        >
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search title or content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} flex-1`}
        />
      </div>

      {visibleEntries.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {entries.length === 0 ? "No knowledge entries yet." : "No entries match your filters."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleEntries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1 rounded border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {entry.title}{" "}
                  <span className="font-normal text-zinc-500">
                    ({CATEGORY_LABELS[entry.category]})
                  </span>
                  {!entry.active && (
                    <span className="ml-1 font-normal text-zinc-500">(inactive)</span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(entry)}
                    disabled={pendingId === entry.id}
                    className="rounded border border-black/[.15] px-2 py-1 text-xs disabled:opacity-50 dark:border-white/[.2]"
                  >
                    {entry.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={pendingId === entry.id}
                    className="rounded border border-red-600/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{entry.content}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <input
            required
            maxLength={200}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} flex-1`}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
            className={inputClass}
          >
            {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <textarea
          required
          maxLength={10_000}
          rows={3}
          placeholder="Content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-fit rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {submitting ? "Adding..." : "Add entry"}
        </button>
      </form>
    </div>
  );
}
