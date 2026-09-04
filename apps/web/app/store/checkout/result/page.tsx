"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { readAuthSession } from "../../../lib/cognito-auth";
import { formatCurrency } from "../../../store/store-utils";
import { useStorefront } from "../../store-client";

const localNotificationsStorageKey = "web-storefront-local-notifications";
const notificationsUpdatedEvent = "storefront-notifications-updated";
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";
const cartStorageKey = "web-storefront-cart";
const processedPaymentPrefix = "web-storefront-payment-processed-";
const pendingOrderRequestPrefix = "web-storefront-order-request-";
const queuePollIntervalMs = 5000;
const queueMaxPollAttempts = 18;

type ReturnPayload = {
  isValidSignature: boolean;
  transactionStatus: "success" | "failed" | "expired";
  message: string;
  txnRef: string;
  amount: number;
  orderInfo: string;
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
};

type NotificationApiItem = {
  id: string;
  title: string;
  message: string;
  status: "pending" | "sent" | "read";
  isRead?: boolean;
  channel: "email" | "system";
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type CheckoutGateStatusResponse = {
  requestId?: string;
  status?: "pending" | "allowed" | "blocked" | "completed";
  message?: string;
  failureCode?: string;
  paymentUrl?: string;
  lockedUntil?: string;
  orderId?: string;
};

type QueueTrackingState = "idle" | "polling" | "done" | "failed";

type QueuePanel = {
  tone: string;
  badge: string;
  title: string;
  message: string;
};

function getPendingOrderRequestKey(txnRef: string) {
  return `${pendingOrderRequestPrefix}${txnRef}`;
}

function extractRequestId(orderInfo: string) {
  return orderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0] ?? "";
}

function CheckoutResultPageContent() {
  const searchParams = useSearchParams();
  const { clearCart, theme } = useStorefront();
  const isDark = theme === "dark";
  const verifiedQueryRef = useRef("");

  const [result, setResult] = useState<ReturnPayload | null>(null);
  const [error, setError] = useState("");
  const [hasBroadcastSuccess, setHasBroadcastSuccess] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [queueState, setQueueState] = useState<QueueTrackingState>("idle");
  const [queueMessage, setQueueMessage] = useState("");
  const [matchedNotification, setMatchedNotification] = useState<NotificationApiItem | null>(null);

  useEffect(() => {
    async function verifyPayment() {
      const query = searchParams.toString();
      if (!query) {
        setError("No response data was received from VNPay.");
        return;
      }

      if (verifiedQueryRef.current === query) {
        return;
      }

      verifiedQueryRef.current = query;
      setError("");

      try {
        const response = await fetch(`/api/lambda-proxy/api/payments/vnpay/return?${query}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as ReturnPayload | { message?: string } | null;

        if (!response.ok || !payload || !("txnRef" in payload)) {
          throw new Error(payload?.message || "We could not verify the payment result.");
        }

        setResult(payload);
      } catch (verificationError) {
        verifiedQueryRef.current = "";
        setError(verificationError instanceof Error ? verificationError.message : "We could not verify the payment result.");
      }
    }

    void verifyPayment();
  }, [searchParams]);

  useEffect(() => {
    if (!result?.txnRef) {
      return;
    }

    const savedRequestId = window.sessionStorage.getItem(getPendingOrderRequestKey(result.txnRef));
    const fallbackRequestId = extractRequestId(result.orderInfo);
    const nextRequestId = savedRequestId || fallbackRequestId;
    if (!nextRequestId) {
      return;
    }

    setRequestId(nextRequestId);
    setQueueState("polling");
  }, [result?.txnRef]);

  useEffect(() => {
    if (!result || hasBroadcastSuccess) {
      return;
    }

    const isSuccess = result.transactionStatus === "success" && result.isValidSignature;
    if (!isSuccess) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(localNotificationsStorageKey);
      const current = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
      const notificationId = `payment-success-${result.txnRef}`;
      const existed = current.some((item) => String(item.id) === notificationId);

      if (!existed) {
        current.unshift({
          id: notificationId,
          title: "Payment successful",
          message: `Transaction ${result.txnRef} was confirmed for ${formatCurrency(result.amount)}.`,
          status: "sent",
          isRead: false,
          channel: "system",
          createdAt: new Date().toISOString(),
          metadata: {
            txnRef: result.txnRef,
            paymentStatus: "success"
          }
        });
        window.localStorage.setItem(localNotificationsStorageKey, JSON.stringify(current));
        window.dispatchEvent(new Event(notificationsUpdatedEvent));
      }

      setHasBroadcastSuccess(true);
    } catch {}
  }, [hasBroadcastSuccess, result]);

  useEffect(() => {
    function finalizeSuccessfulCheckout() {
      if (!result) {
        return;
      }

      const isSuccess = result.transactionStatus === "success" && result.isValidSignature;
      if (!isSuccess) {
        return;
      }

      const processedKey = `${processedPaymentPrefix}${result.txnRef}`;
      if (window.sessionStorage.getItem(processedKey)) {
        return;
      }

      const rawPendingCheckout = window.localStorage.getItem(pendingCheckoutStorageKey);
      if (!rawPendingCheckout) {
        window.localStorage.removeItem(cartStorageKey);
        clearCart();
        return;
      }

      let pendingCheckout: { requestId?: string } | null = null;
      try {
        pendingCheckout = JSON.parse(rawPendingCheckout) as { requestId?: string };
      } catch {
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        return;
      }

      const nextRequestId = String(pendingCheckout?.requestId ?? "").trim() || extractRequestId(result.orderInfo);
      window.sessionStorage.setItem(processedKey, "1");
      if (nextRequestId) {
        window.sessionStorage.setItem(getPendingOrderRequestKey(result.txnRef), nextRequestId);
        setRequestId(nextRequestId);
        setQueueState("polling");
        setQueueMessage("Payment has been confirmed. The system is synchronizing your order from the reserved checkout request.");
      }

      window.localStorage.removeItem(cartStorageKey);
      window.localStorage.removeItem(pendingCheckoutStorageKey);
      clearCart();
    }

    finalizeSuccessfulCheckout();
  }, [clearCart, result]);

  useEffect(() => {
    if (!result || (result.transactionStatus === "success" && result.isValidSignature)) {
      return;
    }

    // Keep the cart so the customer can start a fresh checkout, but never keep
    // a reference to the expired or failed reservation/payment attempt.
    window.localStorage.removeItem(pendingCheckoutStorageKey);
    window.sessionStorage.removeItem(getPendingOrderRequestKey(result.txnRef));
  }, [result]);

  useEffect(() => {
    if (!requestId || !result?.txnRef || queueState === "done" || queueState === "failed") {
      return;
    }

    const session = readAuthSession();
    if (!session?.idToken) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function pollQueueResult() {
      attempts += 1;
      try {
        const gateResponse = await fetch(`/api/lambda-proxy/api/storefront/checkout/prepare/${requestId}`, {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });

        if (!gateResponse.ok) {
          throw new Error("We could not check the checkout synchronization status.");
        }

        const gatePayload = (await gateResponse.json().catch(() => null)) as CheckoutGateStatusResponse | null;
        if (cancelled || !gatePayload?.status) {
          return;
        }

        if (gatePayload.status === "completed") {
          setQueueState("done");
          setQueueMessage(gatePayload.message || "Your order has been recorded successfully.");
          setMatchedNotification({
            id: `checkout-completed-${requestId}`,
            title: "Order recorded successfully",
            message: gatePayload.message || "Payment has been confirmed and your order has already been synchronized.",
            status: "sent",
            isRead: false,
            channel: "system",
            createdAt: new Date().toISOString(),
            metadata: {
              requestId,
              orderId: gatePayload.orderId ?? "",
              paymentStatus: "success"
            }
          });
          window.sessionStorage.removeItem(getPendingOrderRequestKey(result.txnRef));
          return;
        }

        if (gatePayload.status === "blocked") {
          setQueueState("failed");
          setQueueMessage(gatePayload.message || "The order could not be synchronized after payment.");
          window.sessionStorage.removeItem(getPendingOrderRequestKey(result.txnRef));
          return;
        }

        const notificationResponse = await fetch("/api/lambda-proxy/api/notifications/me", {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });

        if (!notificationResponse.ok) {
          return;
        }

        const notificationPayload = (await notificationResponse.json().catch(() => null)) as { items?: NotificationApiItem[] } | null;
        const notification = (notificationPayload?.items ?? []).find((item) => String(item.metadata?.requestId ?? "") === requestId);

        if (!notification || cancelled) {
          return;
        }

        setMatchedNotification(notification);

        const failureCode = String(notification.metadata?.failureCode ?? "").trim();
        if (failureCode) {
          setQueueState("failed");
          setQueueMessage(notification.message);
          window.sessionStorage.removeItem(getPendingOrderRequestKey(result.txnRef));
          return;
        }
      } catch (pollError) {
        if (!cancelled) {
          setQueueMessage(pollError instanceof Error ? pollError.message : "We could not check the queue status right now.");
        }
      }

      if (!cancelled && attempts >= queueMaxPollAttempts) {
        setQueueState("failed");
        setQueueMessage("Order processing is taking too long. Please check the worker and DLQ on AWS.");
      }
    }

    void pollQueueResult();
    const intervalId = window.setInterval(() => {
      void pollQueueResult();
    }, queuePollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [queueState, requestId, result?.txnRef]);

  const isSuccess = result?.transactionStatus === "success" && result.isValidSignature;
  const isExpired = result?.transactionStatus === "expired";
  const canStartNewCheckout = Boolean(result) && !isSuccess;
  const resultHeading = isSuccess
    ? "payment has been confirmed"
    : isExpired
      ? "Phiên thanh toán đã hết hạn"
      : result
        ? "Giao dịch chưa hoàn tất"
        : "Đang xác minh giao dịch";
  const resultDescription = isSuccess
    ? "Hệ thống đang đồng bộ đơn hàng từ checkout đã được giữ hàng."
    : isExpired
      ? "Stock hold của giao dịch cũ đã được giải phóng. Bạn có thể tạo một giao dịch mới từ giỏ hàng hiện tại."
      : result
        ? "Không có đơn hàng nào được tạo từ giao dịch này. Bạn có thể kiểm tra lại giỏ hàng và bắt đầu một giao dịch mới."
        : error || "Đang nhận kết quả thanh toán từ VNPay.";
  const shouldShowQueueNotification =
    Boolean(matchedNotification) &&
    (queueState !== "done" || matchedNotification?.message !== queueMessage);

  const queuePanel = useMemo<QueuePanel | null>(() => {
    if (!isSuccess || !requestId) {
      return null;
    }

    if (queueState === "polling") {
      return {
        tone: isDark ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-100" : "border-cyan-200 bg-cyan-50 text-cyan-800",
        badge: "Processing",
        title: "Your order is being synchronized",
        message: queueMessage || "Your request is already in the queue. The system is tracking its status to complete the order."
      };
    }

    if (queueState === "done") {
      return {
        tone: isDark ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-800",
        badge: "Completed",
        title: "Your order has been recorded",
        message: queueMessage || "The queue finished processing and the order was created successfully."
      };
    }

    if (queueState === "failed") {
      return {
        tone: isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800",
        badge: "Needs review",
        title: "Your order is not fully completed yet",
        message: queueMessage || "The queue responded, but the order could not be completed fully."
      };
    }

    return {
      tone: isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-800",
      badge: "Received",
      title: "The system is preparing your order request",
      message: queueMessage || "Your request has been received. The system is preparing to check the queue status."
    };
  }, [isDark, isSuccess, queueMessage, queueState, requestId]);

  return (
    <main className="px-4 py-12 sm:px-6 lg:px-8">
      <div
        className={`mx-auto max-w-3xl rounded-[2rem] border p-8 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.25)] ${
          isDark ? "border-white/10 bg-[#101826] text-white" : "border-slate-200 bg-white text-slate-950"
        }`}
      >
        <p className={`text-xs font-semibold uppercase tracking-[0.28em] ${isSuccess ? "text-emerald-500" : isExpired ? "text-rose-500" : "text-orange-500"}`}>
          {isSuccess ? "Payment confirmed" : isExpired ? "Payment expired" : "Payment not completed"}
        </p>
        <h1 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>
          {resultHeading}
        </h1>
        <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
          {resultDescription}
        </p>

        {result && !isSuccess ? (
          <div className={`mt-6 rounded-[1.5rem] border p-5 ${
            isExpired
              ? isDark
                ? "border-rose-500/25 bg-rose-500/10 text-rose-100"
                : "border-rose-200 bg-rose-50 text-rose-900"
              : isDark
                ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}>
            <p className="text-sm font-semibold">{result.message}</p>
            <p className="mt-2 text-sm leading-6 opacity-90">
              Mã giao dịch cũ không thể được dùng lại. Khi tiếp tục, hệ thống sẽ kiểm tra tồn kho và tạo một payment session VNPay hoàn toàn mới.
            </p>
          </div>
        ) : null}

        {queuePanel ? (
          <div className={`mt-7 rounded-[1.75rem] border p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.45)] ${queuePanel.tone}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="inline-flex rounded-full border border-current/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]">
                  {queuePanel.badge}
                </span>
                <p className="mt-3 text-lg font-semibold">{queuePanel.title}</p>
              </div>
              <div className={`min-w-[12rem] rounded-2xl px-3 py-2 text-xs ${isDark ? "bg-slate-950/30 text-slate-200" : "bg-white/80 text-slate-600"}`}>
                <p className="font-semibold">Request ID</p>
                <p className="mt-1 break-all opacity-90">{requestId}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 opacity-95">{queuePanel.message}</p>
          </div>
        ) : null}

        {error ? (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              isSuccess
                ? isDark
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                  : "border-amber-200 bg-amber-50 text-amber-700"
                : isDark
                  ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                  : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {error}
          </div>
        ) : null}

        {result ? (
          <div className={`mt-8 grid gap-4 rounded-[1.75rem] border p-5 sm:grid-cols-2 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50/80"}`}>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Store transaction reference</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.txnRef || "--"}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Amount</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(result.amount)}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Bank</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.bankCode || "--"}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Response code</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.responseCode || "--"}</p>
            </div>
          </div>
        ) : null}

        {shouldShowQueueNotification && matchedNotification ? (
          <div className={`mt-6 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50/75"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Queue notification</p>
            <h2 className={`mt-3 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{matchedNotification.title}</h2>
            <p className={`mt-2 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{matchedNotification.message}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          {canStartNewCheckout ? (
            <Link href="/store/checkout" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
              Tạo giao dịch mới
            </Link>
          ) : null}
          <Link
            href={canStartNewCheckout ? "/store" : "/store/products"}
            className={`rounded-full px-5 py-3 text-sm font-semibold ${
              isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
            }`}
          >
            {canStartNewCheckout ? "Quay lại giỏ hàng" : "Tiếp tục mua sắm"}
          </Link>
          {isSuccess ? (
            <Link
              href="/store/orders"
              className={`rounded-full px-5 py-3 text-sm font-semibold ${
                isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
              }`}
            >
              Xem lịch sử đơn hàng
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function CheckoutResultPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutResultPageContent />
    </Suspense>
  );
}
