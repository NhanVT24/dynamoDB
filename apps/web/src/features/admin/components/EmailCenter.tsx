"use client";

import { useEffect, useState } from "react";

type Props = { authToken: string };
type RecipientMode = "customers" | "manual";
type VerifiedCustomer = { email: string; displayName: string; emailVerified: true };
type Recipient = { recipientId: string; recipientEmail: string; status: string; failureReason?: string };
type Delivery = { id: string; subject: string; recipientCount: number; sendStatus: string; createdAt: string };
type Detail = { meta: Delivery; recipients: Recipient[] };

const statusColor: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", accepted: "bg-sky-100 text-sky-800", delivered: "bg-emerald-100 text-emerald-800",
  bounced: "bg-rose-100 text-rose-800", complained: "bg-rose-100 text-rose-800", rejected: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800", unknown: "bg-violet-100 text-violet-800", delivery_delayed: "bg-orange-100 text-orange-800"
};

export default function EmailCenter({ authToken }: Props) {
  const [mode, setMode] = useState<RecipientMode>("customers");
  const [customers, setCustomers] = useState<VerifiedCustomer[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((value) => value === message ? null : value), 4500);
  }

  async function request<T>(path: string, init?: RequestInit) {
    const response = await fetch(`/api/lambda-proxy${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${authToken}`, ...(init?.headers ?? {}) },
      cache: "no-store"
    });
    const json = await response.json().catch(() => null) as T & { message?: string };
    if (!response.ok) throw new Error(json?.message || `Request failed (${response.status}).`);
    return json;
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const data = await request<{ items: Delivery[] }>("/api/admin/email-deliveries?limit=50");
      setDeliveries(data.items ?? []);
      if (detail?.meta.id) await loadDeliveryDetail(detail.meta.id);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load delivery history."); }
    finally { setLoadingHistory(false); }
  }

  async function loadDeliveryDetail(id: string) {
    try { setDetail(await request<Detail>(`/api/admin/email-deliveries/${encodeURIComponent(id)}`)); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not load delivery recipients."); }
  }

  async function viewDelivery(id: string) {
    if (detail?.meta.id === id) return setDetail(null);
    await loadDeliveryDetail(id);
  }

  async function retryDelivery() {
    if (!detail) return;
    setIsRetrying(true);
    try {
      const result = await request<{ recipientCount: number }>(`/api/admin/email-deliveries/${encodeURIComponent(detail.meta.id)}/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() })
      });
      notify(`Queued a safe retry for ${result.recipientCount} recipient(s).`);
      await loadHistory();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not queue retry."); }
    finally { setIsRetrying(false); }
  }

  useEffect(() => { void loadHistory(); }, [authToken]);
  useEffect(() => {
    const abort = new AbortController();
    request<VerifiedCustomer[]>("/api/admin/customers?limit=100", { signal: abort.signal })
      .then((data) => { if (!abort.signal.aborted) setCustomers(Array.isArray(data) ? data : []); })
      .catch((error) => { if (!abort.signal.aborted) notify(error instanceof Error ? error.message : "Could not load customers."); });
    return () => abort.abort();
  }, [authToken]);

  function addRecipient(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return notify(`Invalid email: ${email}`);
    setSelectedEmails((items) => items.includes(email) ? items : [...items, email]);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEmails.length || !subject.trim() || !body.trim()) return notify("Subject, content, and at least one recipient are required.");
    setIsSending(true);
    try {
      const data = await request<{ recipientCount: number; batchCount: number; batches: Array<{ emailJobId: string }> }>("/api/admin/email-deliveries/sale", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients: selectedEmails, subject, body })
      });
      setSelectedEmails([]); setSelectedCustomer(""); setManualEmail(""); setSubject(""); setBody("");
      await loadHistory();
      notify(`Queued ${data.recipientCount} recipient(s) in ${data.batchCount} batch(es).`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not queue sale email."); }
    finally { setIsSending(false); }
  }

  return <div className="grid gap-5">
    {toast ? <div role="status" className="fixed right-5 top-5 z-50 max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl">{toast}</div> : null}
    <section className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-sm"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Email center</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Sale notifications & delivery tracking</h1></section>
    <section className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={send} className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">New sale notification</h2>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex rounded-xl border border-slate-200 bg-white p-1"><button type="button" onClick={() => setMode("customers")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${mode === "customers" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Customer list</button><button type="button" onClick={() => setMode("manual")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${mode === "manual" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Manual email</button></div>
          {mode === "customers" ? <label className="mt-3 grid gap-2 text-sm font-bold text-slate-800">Select verified customer<select value={selectedCustomer} onChange={(event) => { if (event.target.value) addRecipient(event.target.value); setSelectedCustomer(""); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-normal"><option value="">Choose a verified customer…</option>{customers.map((customer) => <option key={customer.email} value={customer.email}>{customer.displayName} — {customer.email}</option>)}</select></label> : <div className="mt-3"><label className="grid gap-2 text-sm font-bold text-slate-800">Add one email<input value={manualEmail} onChange={(event) => setManualEmail(event.target.value)} placeholder="customer@example.com" className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-normal" /></label><button type="button" onClick={() => { addRecipient(manualEmail); setManualEmail(""); }} className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-bold text-cyan-800">Add email</button></div>}</div>
        <div className="mt-4 flex flex-wrap gap-2">{selectedEmails.length ? selectedEmails.map((email) => <button type="button" key={email} onClick={() => setSelectedEmails((items) => items.filter((item) => item !== email))} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{email} ×</button>) : <p className="text-xs text-slate-500">No recipient selected yet.</p>}</div>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 font-normal" placeholder="Weekend sale" /></label><label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">Email content<textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-32 resize-y rounded-xl border border-slate-200 px-3 py-2 font-normal leading-6" placeholder="Write the sale announcement here…" /></label><button disabled={isSending} className="mt-4 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSending ? "Queueing…" : "Send sale email"}</button>
      </form>
      <section className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">Delivery attempts</h2><p className="mt-1 text-sm text-slate-600">Select a batch to inspect each recipient.</p></div><button type="button" onClick={() => void loadHistory()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Refresh</button></div>
        <div className="mt-4 max-h-52 space-y-2 overflow-y-auto">{loadingHistory ? <p className="text-sm text-slate-500">Loading history…</p> : !deliveries.length ? <p className="text-sm text-slate-500">No email delivery batches yet.</p> : deliveries.map((delivery) => <button type="button" key={delivery.id} onClick={() => void viewDelivery(delivery.id)} className={`w-full rounded-xl border p-3 text-left ${detail?.meta.id === delivery.id ? "border-cyan-500 bg-cyan-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex justify-between gap-3"><span className="truncate text-sm font-bold text-slate-800">{delivery.subject}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${statusColor[delivery.sendStatus] ?? "bg-slate-100 text-slate-700"}`}>{delivery.sendStatus}</span></div><p className="mt-1 text-xs text-slate-500">{delivery.recipientCount} recipient(s) · {new Date(delivery.createdAt).toLocaleString()}</p></button>)}</div>
        {detail ? <div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-start justify-between gap-3"><p className="min-w-0 flex-1 break-all text-sm font-bold text-slate-800">Recipients — {detail.meta.subject}</p>{detail.recipients.some((recipient) => ["failed", "not_sent", "rejected"].includes(recipient.status)) ? <button type="button" disabled={isRetrying} onClick={() => void retryDelivery()} className="shrink-0 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 disabled:opacity-60">{isRetrying ? "Queueing…" : "Retry safe failures"}</button> : null}</div><div className="mt-2 max-h-52 space-y-2 overflow-y-auto">{detail.recipients.map((recipient) => <div key={recipient.recipientId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm text-slate-700">{recipient.recipientEmail}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${statusColor[recipient.status] ?? "bg-slate-100 text-slate-700"}`}>{recipient.status}</span></div>{recipient.failureReason ? <p className="mt-1 text-xs text-rose-700">{recipient.failureReason}</p> : null}</div>)}</div></div> : <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Select a delivery batch to view recipient status.</div>}</section>
    </section>
  </div>;
}
