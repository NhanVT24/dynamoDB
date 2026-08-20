"use client";

import { useEffect, useState } from "react";
import { readAuthSession } from "../../lib/cognito-auth";
import { useStorefront } from "../store-client";
import { formatCurrency } from "../store-utils";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";

type PrepareCheckoutResponse = {
  requestId?: string;
  status?: "pending" | "allowed" | "blocked";
  message?: string;
};

type CheckoutGateStatusResponse = {
  requestId?: string;
  status?: "pending" | "allowed" | "blocked";
  message?: string;
  failureCode?: string;
  paymentUrl?: string;
  lockedUntil?: string;
};

export default function CheckoutPage() {
  const { items, subtotal, shipping, total, theme, openAuthModal } = useStorefront();
  const isDark = theme === "dark";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [gateRequestId, setGateRequestId] = useState("");
  const [gateStatus, setGateStatus] = useState<"idle" | "pending" | "allowed" | "blocked">("idle");
  const [gateMessage, setGateMessage] = useState("");
  const session = readAuthSession();

  useEffect(() => {
    if (!gateRequestId || gateStatus !== "pending" || !session?.idToken) {
      return;
    }

    let cancelled = false;

    async function pollGateStatus() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${gateRequestId}`, {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as CheckoutGateStatusResponse | null;
        if (!response.ok || !payload?.status || cancelled) {
          return;
        }

        setGateMessage(payload.message || "");

        if (payload.status === "allowed" && payload.paymentUrl) {
          setGateStatus("allowed");
          window.localStorage.setItem(
            pendingCheckoutStorageKey,
            JSON.stringify({
              email: session.email ?? "",
              requestId: gateRequestId,
              items: items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity
              })),
              createdAt: new Date().toISOString()
            })
          );
          window.location.assign(payload.paymentUrl);
          return;
        }

        if (payload.status === "blocked") {
          setGateStatus("blocked");
          setIsSubmitting(false);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "Khong the kiem tra hang doi checkout luc nay.");
          setIsSubmitting(false);
        }
      }
    }

    void pollGateStatus();
    const intervalId = window.setInterval(() => {
      void pollGateStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [gateRequestId, gateStatus, items, session]);

  async function handleCheckout() {
    if (items.length === 0) {
      setError("Gio hang dang trong, ban hay chon them san pham truoc khi thanh toan.");
      return;
    }

    if (!apiBaseUrl) {
      setError("Thieu NEXT_PUBLIC_API_URL de khoi tao thanh toan.");
      return;
    }

    try {
      if (!session?.idToken) {
        openAuthModal("/store/checkout");
        return;
      }

      setIsSubmitting(true);
      setError("");
      setGateStatus("pending");
      setGateMessage("Yeu cau dang vao hang doi kiem tra ton kho va tranh chap san pham.");
      const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.idToken}`
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          })),
          locale: "vn"
        })
      });

      const payload = (await response.json().catch(() => null)) as PrepareCheckoutResponse | null;

      if (!response.ok || !payload?.requestId) {
        throw new Error(payload?.message || "Khong the dua yeu cau checkout vao hang doi.");
      }

      setGateRequestId(payload.requestId);
    } catch (checkoutError) {
      setGateStatus("blocked");
      setError(checkoutError instanceof Error ? checkoutError.message : "Khong the bat dau kiem tra checkout.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section
          className={`rounded-[2rem] border p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.25)] ${
            isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-950"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Checkout</p>
          <h1 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Thanh toan voi VNPay Sandbox</h1>
          <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            He thong se dua yeu cau vao queue kiem tra tranh chap san pham truoc. Chi khi duoc giu cho thanh cong, ban moi duoc chuyen sang VNPay.
          </p>
          {!session ? (
            <div className={`mt-6 rounded-[1.5rem] border px-4 py-4 text-sm ${isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              Ban can dang nhap truoc khi thanh toan.
            </div>
          ) : null}

          <div className="mt-8 space-y-4">
            {items.map((item) => (
              <article
                key={item.variantId}
                className={`flex gap-4 rounded-[1.5rem] border p-4 ${
                  isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                }`}
              >
                <img src={item.image} alt={item.productName} className="h-20 w-20 rounded-3xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className={`line-clamp-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.productName}</h2>
                      <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{item.variantName}</p>
                    </div>
                    <strong className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(item.price * item.quantity)}</strong>
                  </div>
                  <p className={`mt-3 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>So luong: {item.quantity}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.5)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-300">Tom tat don hang</p>
          <div className="mt-6 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Tam tinh</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Phi van chuyen</span>
              <span>{shipping === 0 ? "Mien phi" : formatCurrency(shipping)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/15 pt-4 text-lg font-semibold">
              <span>Tong thanh toan</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] bg-white/8 p-4 text-sm leading-7 text-slate-200">
            <p>Queue gate se xu ly cac checkout cung san pham theo thu tu den truoc.</p>
            <p className="mt-2">Neu san pham dang bi request khac giu cho, ban se thay thong bao chan ngay tai day.</p>
          </div>

          {gateStatus === "pending" ? (
            <div className="mt-6 rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              {gateMessage || "Dang cho queue xet quyen thanh toan cho gio hang nay."}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={isSubmitting || items.length === 0 || gateStatus === "pending"}
            className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {session ? (gateStatus === "pending" ? "Dang cho queue..." : "Thanh toan ngay") : "Dang nhap de thanh toan"}
          </button>
        </aside>
      </div>
    </main>
  );
}
