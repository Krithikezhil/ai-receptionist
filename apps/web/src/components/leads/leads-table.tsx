"use client";

import { useMemo, useState } from "react";
import {
  deleteLead,
  updateLeadStatus,
  type Lead,
  type LeadStatus,
} from "../../lib/leads-client";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  closed: "Closed",
};

const inputClass =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-black dark:border-white/[.2] dark:text-zinc-50";

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function LeadsTable({
  organizationId,
  initialLeads,
}: {
  organizationId: string;
  initialLeads: Lead[];
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visibleLeads = useMemo(() => {
    if (statusFilter === "all") return leads;
    return leads.filter((lead) => lead.status === statusFilter);
  }, [leads, statusFilter]);

  async function handleStatusChange(lead: Lead, status: LeadStatus) {
    setError(null);
    setPendingId(lead.id);
    const previousLeads = leads;
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, status } : l)),
    );

    try {
      const updated = await updateLeadStatus(
        organizationId,
        lead.id,
        status,
      );
      if (!updated) {
        setLeads(previousLeads);
        setError("Could not update lead status.");
        return;
      }
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? updated : l)),
      );
    } catch {
      setLeads(previousLeads);
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(lead: Lead) {
    setError(null);
    setPendingId(lead.id);
    const previousLeads = leads;
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));

    try {
      const success = await deleteLead(organizationId, lead.id);
      if (!success) {
        setLeads(previousLeads);
        setError("Could not delete lead.");
      }
    } catch {
      setLeads(previousLeads);
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Leads
        </h2>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          Status
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as LeadStatus | "all")
            }
            className={inputClass}
          >
            <option value="all">All</option>
            {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {visibleLeads.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {leads.length === 0
            ? "No leads yet."
            : "No leads match this filter."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleLeads.map((lead) => (
            <li
              key={lead.id}
              className="flex flex-col gap-2 rounded border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {lead.contactName ?? "—"}
                </span>

                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Update status for ${
                      lead.contactName ?? "this lead"
                    }`}
                    value={lead.status}
                    onChange={(e) =>
                      handleStatusChange(
                        lead,
                        e.target.value as LeadStatus,
                      )
                    }
                    disabled={pendingId === lead.id}
                    className="rounded border border-black/[.15] bg-transparent px-2 py-1 text-xs disabled:opacity-50 dark:border-white/[.2]"
                  >
                    {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleDelete(lead)}
                    disabled={pendingId === lead.id}
                    className="rounded border border-red-600/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
                <span>Phone: {lead.contactPhone ?? "—"}</span>
                <span>Email: {lead.contactEmail ?? "—"}</span>
                <span>Intent: {lead.intent ?? "—"}</span>
                <span>Created: {formatCreatedAt(lead.createdAt)}</span>
              </div>

              {lead.notes && (
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  Notes: {lead.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
