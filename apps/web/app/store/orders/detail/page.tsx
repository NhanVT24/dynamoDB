"use client";
import { getIntlLocale, t, translateLabel } from "../../../../src/i18n/language";

import { useLanguage } from "../../../../src/i18n/LanguageProvider";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useStorefront } from "../../store-client";
import { fetchOrderDetails, refreshOrderRefundStatus, requestOrderRefund } from "../../store-api";
import type { StoreOrder } from "../../store-types";
import { formatCurrency } from "../../store-utils";
import { getOrderStatusColor, getOrderStatusPanelColor } from "../../order-status";

const statusLabels: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  pending: "Processing",
  done: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  payment_failed: "Payment failed",
  refund_pending: "Refund pending",
  refund_sent: "Refund sent to bank",
  refund_rejected: "Refund rejected"
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function OrderDetailContent() {
  useLanguage();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId")?.trim() ?? "";
  const { session, theme, openAuthModal } = useStorefront();
  const isDark = theme === "dark";
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [serverClockOffset, setServerClockOffset] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOrder(null);
    setError("");
    if (!session || !orderId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    void fetchOrderDetails(orderId).then(
      (result) => { if (!cancelled) { setOrder(result); setServerClockOffset(result.serverNow ? Date.parse(result.serverNow) - Date.now() : 0); } },
      (cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the order."); }
    ).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, session?.accessToken]);

  useEffect(() => {
    if (!order || order.status !== "refund_pending") return;
    const timer = window.setInterval(() => {
      void refreshOrderRefundStatus(order.id)
        .then(() => fetchOrderDetails(order.id))
        .then(setOrder)
        .catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status]);

  const originalTotal = order && order.items.every((item) => typeof item.originalUnitPrice === "number")
    ? order.items.reduce((sum, item) => sum + Math.max(item.price, item.originalUnitPrice!) * item.quantity, 0)
    : undefined;
  const savings = order && originalTotal !== undefined && originalTotal > order.totalAmount
    ? originalTotal - order.totalAmount
    : 0;
  const panelClass = isDark ? "border-white/10 bg-[#101826] text-white" : "border-slate-200 bg-white text-slate-950";
  const refundDeadline = order?.paymentConfirmedAt ? Date.parse(order.paymentConfirmedAt) + 5 * 60 * 1000 : NaN;
  const refundRemainingSeconds = Number.isFinite(refundDeadline) ? Math.max(0, Math.ceil((refundDeadline - now - serverClockOffset) / 1000)) : 0;
  const canRefund = order?.status === "paid" && refundRemainingSeconds > 0;

  useEffect(() => {
    if (!Number.isFinite(refundDeadline) || refundDeadline <= Date.now() + serverClockOffset) return;
    const timer = window.setTimeout(() => setNow(Date.now()), refundDeadline - Date.now() - serverClockOffset);
    return () => window.clearTimeout(timer);
  }, [refundDeadline, serverClockOffset]);

  async function handleRefund() {
    if (!order || !canRefund || refundBusy) return;
    setRefundBusy(true);
    setRefundError("");
    try {
      await requestOrderRefund(order.id);
      setOrder(await fetchOrderDetails(order.id));
    } catch (cause) {
      setRefundError(cause instanceof Error ? cause.message : "Could not submit the refund request.");
      setOrder(await fetchOrderDetails(order.id).catch(() => order));
    } finally {
      setRefundBusy(false);
    }
  }

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/store/orders" className={`text-sm font-semibold ${isDark ? "text-orange-300" : "text-orange-700"}`}>{t("← Order history")}</Link>
        <div className={`mt-5 rounded-3xl border p-6 shadow-sm sm:p-8 ${panelClass}`}>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500">{t("NovaX Market")}</p>
          <h1 className="mt-2 text-3xl font-bold">{t("Order details")}</h1>

          {!orderId ? <p className="mt-6 text-sm">{t("The order link is invalid.")}</p> : null}
          {orderId && !session ? (
            <div className="mt-6">
              <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("Sign in with the account that placed this order to view its receipt and status.")}</p>
              <button type="button" onClick={() => openAuthModal(`/store/orders/detail?orderId=${encodeURIComponent(orderId)}`)} className="mt-4 rounded-full bg-orange-600 px-5 py-3 text-sm font-semibold text-white">{t("Sign in to view the order")}</button>
            </div>
          ) : null}
          {orderId && session && isLoading ? <p role="status" className="mt-6 text-sm">{t("Loading order…")}</p> : null}
          {orderId && session && !isLoading && error ? <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{translateLabel(error)}</p> : null}

          {order ? (
            <>
              <div className={`mt-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-4 ${getOrderStatusPanelColor(order.status, isDark)}`}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider">{t("Status")}</p>
                  <p className={`mt-1 inline-flex rounded-full px-3 py-1 text-sm font-bold ${getOrderStatusColor(order.status, isDark)}`}>{translateLabel(statusLabels[order.status] ?? order.status)}</p>
                  {order.status === "paid" ? (
                    <div className="mt-4">
                      <button type="button" onClick={() => void handleRefund()} disabled={!canRefund || refundBusy}
                        className="rounded-full bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none">
                        {refundBusy ? t("Submitting request…") : t("Request a refund")}
                      </button>
                      <p className="mt-2 text-xs">
                        {!order.paymentConfirmedAt ? t("Payment details are not available for a refund request.")
                          : refundRemainingSeconds > 0
                            ? t("Time left to request a refund: {value1}:{value2}", { value1: Math.floor(refundRemainingSeconds / 60), value2: String(refundRemainingSeconds % 60).padStart(2, "0") })
                            : t("The refund window has closed (5 minutes after payment).")}
                      </p>
                      {refundError ? <p role="alert" className="mt-2 text-sm text-rose-600">{translateLabel(refundError)}</p> : null}
                    </div>
                  ) : null}
                  {order.status.startsWith("refund_") ? (
                    <p className="mt-3 max-w-sm text-sm">{translateLabel(statusLabels[order.status])}{t(". The time it takes to receive your refund depends on your bank.")}</p>
                  ) : null}
                </div>
                <div className="text-sm">
                  <p>{t("Placed at:")} <strong>{formatDateTime(order.createdAt)}</strong></p>
                  {order.paymentConfirmedAt ? <p className="mt-1">{t("Payment confirmed at:")} <strong>{formatDateTime(order.paymentConfirmedAt)}</strong></p> : null}
                </div>
              </div>

              <div className="mt-7 space-y-4">
                <h2 className="text-lg font-bold">{t("Ordered products")}</h2>
                {order.items.map((item) => {
                  const hasDiscount = typeof item.originalUnitPrice === "number" && item.originalUnitPrice > item.price;
                  return (
                    <div key={item.productId} className={`flex flex-wrap justify-between gap-3 border-b pb-4 ${isDark ? "border-white/10" : "border-slate-200"}`}>
                      <div>
                        <p className="font-semibold">{item.productName}</p>
                        <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>{t("Quantity:")} {item.quantity}</p>
                      </div>
                      <div className="text-right text-sm">
                        {hasDiscount ? <p className="text-slate-400 line-through">{formatCurrency(item.originalUnitPrice!)} {t("/ item")}</p> : null}
                        <p>{formatCurrency(item.price)} {t("/ item")}</p>
                        <p className="mt-1 font-bold">{t("Line total:")} {formatCurrency(item.lineTotal)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 text-right">
                {savings > 0 ? <>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>{t("Before discount:")} {formatCurrency(originalTotal!)}</p>
                  <p className="mt-1 text-sm text-emerald-600">{t("Savings: -")}{formatCurrency(savings)}</p>
                </> : null}
                <p className="mt-3 text-sm">{t("Order total")}</p>
                <p className="mt-1 text-3xl font-bold text-orange-600">{formatCurrency(order.totalAmount)}</p>
              </div>
              <p className={`mt-7 break-all rounded-xl p-3 text-xs ${isDark ? "bg-white/5 text-slate-400" : "bg-slate-50 text-slate-500"}`}>{t("Order reference for support:")}{order.id}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  useLanguage();
  return <Suspense fallback={<main className="p-8" role="status">{t("Loading order…")}</main>}><OrderDetailContent /></Suspense>;
}
