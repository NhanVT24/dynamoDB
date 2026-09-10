"use client";

import { useEffect, useState } from "react";

type Props = { authToken: string };
type RecipientMode = "customers" | "manual";
type VerifiedCustomer = { email: string; displayName: string; emailVerified: true };

/** A deliberate draft only: sending is enabled only after the delivery API is wired. */
export default function EmailCenter({ authToken }: Props) {
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("customers");
  const [manualEmail, setManualEmail] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = useState(false);
  const [customers, setCustomers] = useState<VerifiedCustomer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("Choose recipients to prepare a sale notification.");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (recipientMode !== "customers") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingCustomers(true);
      setCustomerError("");
      try {
        const params = new URLSearchParams({ search: customerQuery, limit: "25" });
        // Same-origin proxy forwards the Cognito token. It avoids a browser CORS
        // failure when the Next.js site and API Gateway have different origins.
        const response = await fetch(`/api/lambda-proxy/api/admin/customers?${params.toString()}`, {
          headers: { Authorization: `Bearer ${authToken}` },
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message || `Customer list request failed (${response.status}).`);
        }
        const result = await response.json() as VerifiedCustomer[];
        setCustomers(Array.isArray(result) ? result : []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setCustomers([]);
          setCustomerError(error instanceof Error ? error.message : "Could not load customers.");
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingCustomers(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [authToken, customerQuery, recipientMode]);

  function addRecipient(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return setMessage(`Invalid email: ${normalized}`);
    setSelectedEmails((current) => [...new Set([...current, normalized])]);
  }

  function chooseCustomer(email: string) {
    addRecipient(email);
    setCustomerQuery("");
    setIsCustomerSearchOpen(false);
    setMessage("Customer added to the recipient selection.");
  }

  function addManualRecipient() {
    const email = manualEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMessage(`Invalid email: ${email}`);
    addRecipient(email);
    setManualEmail("");
    setMessage("Email added to the recipient selection.");
  }

  async function sendSaleCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEmails.length || !subject.trim() || !body.trim()) return setMessage("Subject, content, and at least one recipient are required.");
    setIsSending(true);
    setMessage("Sending sale email…");
    try {
      const response = await fetch("/api/lambda-proxy/api/admin/email-deliveries/sale", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ recipients: selectedEmails, subject, body })
      });
      const result = await response.json().catch(() => null) as { recipientCount?: number; attempts?: Array<{ status?: string }>; message?: string } | null;
      if (!response.ok) throw new Error(result?.message || `Could not send sale email (${response.status}).`);
      const statuses = result?.attempts ?? [];
      const unknownCount = statuses.filter((attempt) => attempt.status === "unknown").length;
      setMessage(unknownCount
        ? `${result?.recipientCount ?? selectedEmails.length} recipient(s) submitted; ${unknownCount} batch(es) need delivery-status review.`
        : `${result?.recipientCount ?? selectedEmails.length} recipient(s) submitted to SES.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send sale email.");
    } finally {
      setIsSending(false);
    }
  }

  return <div className="grid gap-5">
    <section className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Email center</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">Sale notifications & delivery tracking</h1>
      <p className="mt-2 text-sm text-slate-600">Recipient status is the source of truth. Email body is not shown in the admin list.</p>
    </section>
    <section className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={sendSaleCampaign} className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">New sale notification</h2>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            <button type="button" onClick={() => setRecipientMode("customers")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${recipientMode === "customers" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Customer list</button>
            <button type="button" onClick={() => setRecipientMode("manual")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${recipientMode === "manual" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Manual email</button>
          </div>
          {recipientMode === "customers" ? <div className="relative mt-3">
            <label className="text-sm font-bold text-slate-800">Select verified customer</label>
            <input value={customerQuery} onFocus={() => setIsCustomerSearchOpen(true)} onChange={(event) => { setCustomerQuery(event.target.value); setIsCustomerSearchOpen(true); }} placeholder="Search customer name or email" className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
            {isCustomerSearchOpen ? <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {isLoadingCustomers ? <p className="p-3 text-xs text-slate-500">Searching customers…</p> : null}
              {!isLoadingCustomers && customerError ? <p className="p-3 text-xs text-rose-600">{customerError}</p> : null}
              {!isLoadingCustomers && !customerError && !customers.length ? <p className="p-3 text-xs text-slate-500">No verified customer matches this search.</p> : null}
              {!isLoadingCustomers && !customerError ? customers.map((customer) => <button type="button" key={customer.email} onMouseDown={(event) => { event.preventDefault(); chooseCustomer(customer.email); }} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 last:border-b-0 hover:bg-cyan-50"><span className="block font-semibold">{customer.displayName}</span><span className="block text-xs text-slate-500">{customer.email}</span></button>) : null}
            </div> : null}
            <p className="mt-2 text-xs text-slate-500">Suggestions include accounts with a verified email address.</p>
          </div> : <div className="mt-3">
            <label className="grid gap-2 text-sm font-bold text-slate-800">Add one email
              <input value={manualEmail} onChange={(event) => setManualEmail(event.target.value)} placeholder="customer@example.com" className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-normal" />
            </label>
            <button type="button" onClick={addManualRecipient} className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-bold text-cyan-800">Add email</button>
            <p className="mt-2 text-xs text-slate-500">Use this only for a one-off recipient you are permitted to contact.</p>
          </div>}
        </div>
        {selectedEmails.length ? <div className="mt-4 flex flex-wrap gap-2">{selectedEmails.map((email) => <button type="button" key={email} onClick={() => setSelectedEmails((current) => current.filter((item) => item !== email))} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{email} ×</button>)}</div> : <p className="mt-4 text-xs text-slate-500">No recipient selected yet.</p>}
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 font-normal" placeholder="Weekend sale" />
        </label>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">Email content
          <textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-32 resize-y rounded-xl border border-slate-200 px-3 py-2 font-normal leading-6" placeholder="Write the sale announcement here…" />
        </label>
        <p className="mt-2 text-xs text-slate-500">This content is used when the campaign is sent, but is intentionally not displayed in the delivery history.</p>
        <button disabled={isSending} className="mt-4 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSending ? "Sending…" : "Send sale email"}</button>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      </form>
      <section className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Delivery attempts</h2>
        <p className="mt-3 text-sm text-slate-600">The delivery API will list each recipient, current status, failure reason, and safe retry action here.</p>
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No delivery selected.</div>
      </section>
    </section>
  </div>;
}
