"use client";

import { useEffect, useState } from "react";
import { apiUrl, authenticatedFetch } from "../../auth/lib/cognito-auth";
import { type AuditLogRecord, type AuditChange, formatTime, describePart, actionTone, resourceTone, fieldLabel, parseAuditValue, displayNestedValue } from "../components/audit-log-display";

function Metadata({ entries }: { entries: Array<[string, string | undefined]> }) {
  const populated = entries.filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  return <dl className="grid gap-4 sm:grid-cols-2">{populated.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold uppercase tracking-wide text-slate-700">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-900">{value}</dd></div>)}</dl>;
}

type AuditLogDetailProps = {
  authToken: string;
  pk: string;
  sk: string;
  initialRecord?: AuditLogRecord;
  onBack: () => void;
};

function stableString(value: unknown) {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return JSON.stringify(value.map(stableString));
    return JSON.stringify(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableString((value as Record<string, unknown>)[key])]));
  }
  return JSON.stringify(value);
}

function valueChanged(before: unknown, after: unknown) {
  return stableString(before) !== stableString(after);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayObjectFieldLabel(key: string, index: number, total: number) {
  return total <= 1 ? key : `Address ${index + 1} ${key}`;
}

function ChangedValues({ change }: { change: AuditChange }) {
  const before = parseAuditValue(change.before);
  const after = parseAuditValue(change.after);

  if (before.kind === "array" || after.kind === "array") {
    const beforeItems = before.kind === "array" ? before.value : [];
    const afterItems = after.kind === "array" ? after.value : [];
    const arrayHasObjects = beforeItems.some(isRecord) || afterItems.some(isRecord);
    if (arrayHasObjects) {
      const count = Math.max(beforeItems.length, afterItems.length);
      const rows = Array.from({ length: count }).flatMap((_, index) => {
        const previous = beforeItems[index];
        const next = afterItems[index];
        if (!valueChanged(previous, next)) return [];
        if (isRecord(previous) || isRecord(next)) {
          const previousRecord = isRecord(previous) ? previous : {};
          const nextRecord = isRecord(next) ? next : {};
          const keys = [...new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])];
          return keys.flatMap((key) => valueChanged(previousRecord[key], nextRecord[key])
            ? [{ label: arrayObjectFieldLabel(key, index, count), before: previousRecord[key], after: nextRecord[key] }]
            : []);
        }
        return [{ label: String(index + 1), before: previous, after: next }];
      });
      return <ChangedRows rows={rows} />;
    }

    const previous = beforeItems.map(String);
    const next = afterItems.map(String);
    const added = next.filter((item) => !previous.includes(item));
    const removed = previous.filter((item) => !next.includes(item));
    return <ChangedRows rows={[
      ...added.map((item) => ({ label: item, before: undefined, after: item })),
      ...removed.map((item) => ({ label: item, before: item, after: undefined }))
    ]} />;
  }

  if (before.kind === "object" || after.kind === "object") {
    const previous = before.kind === "object" ? before.value : {};
    const next = after.kind === "object" ? after.value : {};
    const rows = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .flatMap((key) => valueChanged(previous[key], next[key]) ? [{ label: key, before: previous[key], after: next[key] }] : []);
    return <ChangedRows rows={rows} />;
  }

  return <ChangedRows rows={[{ label: "Value", before: change.before, after: change.after }]} />;
}

function ChangedRows({ rows }: { rows: Array<{ label: string; before: unknown; after: unknown }> }) {
  if (!rows.length) return null;
  return <div className="overflow-hidden rounded-lg border border-slate-200">
    <div className="hidden grid-cols-[12rem_1fr_1fr] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 md:grid">
      <span>Property</span>
      <span>New</span>
      <span>Old</span>
    </div>
    <div className="divide-y divide-slate-100">{rows.map((row) => (
      <div key={`${row.label}:${displayNestedValue(row.before)}:${displayNestedValue(row.after)}`} className="grid gap-2 bg-white px-3 py-3 text-sm md:grid-cols-[12rem_1fr_1fr] md:gap-3">
        <strong className="break-all text-slate-900">{row.label}</strong>
        <span className="break-all rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{displayNestedValue(row.after)}</span>
        <span className="break-all rounded-md bg-rose-50 px-3 py-2 text-rose-800">{displayNestedValue(row.before)}</span>
      </div>
    ))}</div>
  </div>;
}

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
          <h3 className="mb-3 text-base font-bold text-slate-950">{fieldLabel(field)}</h3>
          <ChangedValues change={change} />
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
