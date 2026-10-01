"use client";

import { useEffect, useState } from "react";
import { apiUrl, authenticatedFetch } from "../../auth/lib/cognito-auth";
import { type AuditLogRecord, type AuditChange, formatTime, describePart, actionTone, resourceTone, displayValue } from "../components/audit-log-display";

function Metadata({ entries }: { entries: Array<[string, string | undefined]> }) {
  const populated = entries.filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  return <dl className="grid gap-4 sm:grid-cols-2">{populated.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold uppercase tracking-wide text-slate-700">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-900">{value}</dd></div>)}</dl>;
}

function permissionValues(value: string | null): string[] | null {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : null;
  } catch { return null; }
}

function PermissionDiff({ change }: { change: AuditChange }) {
  const before = permissionValues(change.before), after = permissionValues(change.after);
  if (!before || !after) return null;
  const added = after.filter((permission) => !before.includes(permission));
  const removed = before.filter((permission) => !after.includes(permission));
  return <div className="mt-3 space-y-1 text-sm"><p className="break-all text-emerald-700">Added: {added.join(", ") || "None"}</p><p className="break-all text-rose-700">Removed: {removed.join(", ") || "None"}</p></div>;
}

type AuditLogDetailProps = {
  authToken: string;
  pk: string;
  sk: string;
  initialRecord?: AuditLogRecord;
  onBack: () => void;
};

export default function AuditLogDetail({ authToken, pk, sk, initialRecord, onBack }: AuditLogDetailProps) {
  const [record, setRecord] = useState<AuditLogRecord | null>(initialRecord ?? null);
  const [loading, setLoading] = useState(!initialRecord);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (revision === 0 && initialRecord?.PK === pk && initialRecord.SK === sk) {
      setRecord(initialRecord);
      setLoading(false);
      return;
    }
    setRecord(null);
    setError("");
    if (!pk || !sk) { setError("Invalid audit link: event key is missing."); setLoading(false); return; }
    setLoading(true);
    async function load() {
      try {
        const response = await authenticatedFetch(apiUrl(`/api/admin/audit-logs/detail?${new URLSearchParams({ pk, sk })}`), {
          headers: { Authorization: `Bearer ${authToken}` }, cache: "no-store"
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(response.status === 404 ? "Audit event not found." : payload?.message || "Could not load audit event.");
        }
        const item = await response.json() as AuditLogRecord;
        if (!cancelled) setRecord(item);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load audit event.");
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [authToken, pk, sk, revision, initialRecord]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage("Copied."); }
    catch { setCopyMessage("Could not copy. Select the text and copy manually."); }
  }

  return <section aria-label="Audit event details" className="space-y-6 p-4 text-slate-900 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="font-bold text-cyan-700">← Back to audit history</button>
      <div className="flex gap-2"><button type="button" onClick={() => void copy(window.location.href)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">Copy link</button><button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh</button></div>
    </div>
    <p role="status" className="text-sm text-slate-600">{copyMessage}</p>
    <h1 className="text-3xl font-bold">Audit event details</h1>
    {loading ? <p role="status">Loading audit event...</p> : null}
    {error ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}<button type="button" onClick={() => setRevision((value) => value + 1)} className="ml-3 underline">Retry</button></div> : null}
    {record ? <>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-5 flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${resourceTone(record.resourceType)}`}>{describePart(record)}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${actionTone(record.action)}`}>{record.action}</span></div>
        <Metadata entries={[["Resource ID", record.resourceId], ["Occurred at (UTC+7)", formatTime(record.occurredAt)], ["Related order ID", record.parentResourceId], ["Payment transaction reference", record.paymentTxnRef]]} />
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">Changes</h2>
        <p className="mb-4 text-sm text-slate-500">Historical values of tracked fields for this event.</p>
        <div className="space-y-4">{Object.entries(record.changes ?? {}).map(([field, change]) => <div key={field} className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 font-bold">{field === "avatarKey" ? "Avatar key" : field === "displayName" ? "Display name" : field}</h3>
          <div className="grid gap-3 md:grid-cols-2"><div className="min-w-0 rounded-lg bg-rose-50 p-3"><p className="text-xs font-bold uppercase text-rose-700">Before</p><p className="mt-2 whitespace-pre-wrap break-all text-sm">{displayValue(change.before, "")}</p></div><div className="min-w-0 rounded-lg bg-emerald-50 p-3"><p className="text-xs font-bold uppercase text-emerald-700">After</p><p className="mt-2 whitespace-pre-wrap break-all text-sm">{displayValue(change.after, "")}</p></div></div>
          {field === "permissions" ? <PermissionDiff change={change} /> : null}
        </div>)}</div>
        {!Object.keys(record.changes ?? {}).length ? <p className="text-sm text-slate-500">No tracked field changes recorded.</p> : null}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">Actor and context</h2>
        <Metadata entries={[["Actor type", record.actor?.type], ["Actor ID", record.actor?.id], ["Actor role", record.actor?.role], ["Actor email (current)", record.actor?.email], ["Resource owner email (current)", record.ownerEmail], ["Source", record.context?.source], ["Reason", record.context?.reason], ["Request ID", record.context?.requestId]]} />
        <p className="mt-4 text-xs text-slate-500">Emails are resolved from current account/order data; they are not historical snapshots.</p>
      </section>
      <details className="rounded-xl border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer font-bold">Technical metadata</summary>
        <p className="mt-3 text-sm text-slate-500">For troubleshooting: identify the original DynamoDB event and audit record, then correlate with worker or request logs when those identifiers are logged.</p>
        <div className="mt-4"><Metadata entries={[["Event ID", record.source?.eventId], ["DynamoDB event", record.eventName], ["Source PK", record.source?.pk], ["Source SK", record.source?.sk], ["Sequence number", record.source?.sequenceNumber], ["Audit writer", record.context?.auditWriter], ["Audit PK", record.PK], ["Audit SK", record.SK]]} /></div>
        <button type="button" onClick={() => void copy(JSON.stringify(record, null, 2))} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold">Copy event JSON</button>
      </details>
    </> : null}
  </section>;
}
