"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl, authenticatedFetch } from "../../auth/lib/cognito-auth";

import { type AuditResourceType, type AuditLogRecord, formatTime, resourceTone, actionTone, describePart, changedFieldCount, fieldLabel, summarizeChange } from "./audit-log-display";

const resourceTabs: Array<{ value: AuditResourceType; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ORDER", label: "Orders" },
  { value: "PAYMENT", label: "Payments" },
  { value: "USER", label: "Users" },
  { value: "PRODUCT", label: "Products" },
  { value: "SALE_CAMPAIGN", label: "Sales" },
  { value: "NOTIFICATION", label: "Notifications" },
  { value: "CHECKOUT", label: "Checkout" },
  { value: "EMAIL", label: "Emails" },
  { value: "EMAIL_ROUTE", label: "Email routing" },
  { value: "OPERATION", label: "Operations" }
];

export default function AuditLogViewer({ authToken, onSelect }: { authToken: string; onSelect: (record: AuditLogRecord) => void }) {
  const [resourceType, setResourceType] = useState<AuditResourceType>("ALL");
  const [items, setItems] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pageCursor = cursors[pageIndex];

  async function loadAuditLogs(nextResourceType = resourceType) {
    const version = ++requestVersion.current;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ resourceType: nextResourceType, limit: "5" });
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await authenticatedFetch(apiUrl(`/api/admin/audit-logs?${params.toString()}`), {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: "no-store"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || "Could not load audit logs.");
      }
      const page = await response.json() as { items: AuditLogRecord[]; nextCursor: string | null };
      if (version !== requestVersion.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (version === requestVersion.current) {
        setItems([]);
        setNextCursor(null);
        setMessage(error instanceof Error ? error.message : "Could not load audit logs.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadAuditLogs(resourceType);
    return () => { requestVersion.current += 1; };
  }, [resourceType, pageCursor, authToken]);

  return (
    <section aria-label="Audit history" className="min-w-0 border-y border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Audit Trail</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">Change History</h2>
        </div>
        <button type="button" onClick={() => void loadAuditLogs()} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh</button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {resourceTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setResourceType(tab.value);
              setCursors([undefined]);
              setPageIndex(0);
              setNextCursor(null);
            }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${resourceType === tab.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{message}</p> : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">Loading audit logs...</p> : null}
      {!loading && items.length === 0 && !message ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          No audit records found for this filter.
        </div>
      ) : null}

      <div className="mt-6">
        {!loading && items.length > 0 ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Newest changes</h3>
              <span className="text-xs font-semibold text-slate-400">{items.length} records</span>
            </div>
            <div className="grid gap-4">
              {items.map((record) => (
                <article key={`${record.PK}:${record.SK}`} className="min-w-0 rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${resourceTone(record.resourceType)}`}>{describePart(record)}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${actionTone(record.action)}`}>{record.action}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{changedFieldCount(record)} fields</span>
                      </div>
                      <h3 className="mt-3 break-all text-base font-bold text-slate-950">{record.ownerEmail ?? "Email unavailable"}</h3>
                      {record.resourceType !== "USER" ? <p className="mt-1 break-all text-xs text-slate-500">{describePart(record)}: {record.resourceId}</p> : null}
                      {record.parentResourceId ? <p className="mt-1 text-xs font-semibold text-slate-500">Order: <span className="text-slate-800">{record.parentResourceId}</span></p> : null}
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatTime(record.occurredAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">{record.eventName}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 text-sm text-slate-600">
                      <p className="break-all"><strong>Changed by:</strong> {record.actor?.email ?? record.actor?.id ?? "Not captured"} ({record.actor?.type ?? "UNKNOWN"})</p>
                      <div className="mt-2 space-y-2">{Object.entries(record.changes ?? {}).map(([field, change]) => (
                        <p key={field} className="whitespace-pre-wrap break-all"><strong className="text-slate-900">{fieldLabel(field)}:</strong> {summarizeChange(change, field)}</p>
                      ))}</div>
                    </div>
                    <button type="button" onClick={() => onSelect(record)} className="shrink-0 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-800 hover:bg-cyan-100">View details &rarr;</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <nav aria-label="Audit pagination" className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <button type="button" disabled={loading || pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">Previous</button>
        <span className="text-sm text-slate-600">Page {pageIndex + 1}</span>
        <button type="button" disabled={loading || !nextCursor} onClick={() => {
          if (!nextCursor) return;
          setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
          setPageIndex((index) => index + 1);
        }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">Next</button>
      </nav>
    </section>
  );
}
