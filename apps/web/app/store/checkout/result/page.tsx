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

type FinalizeOrderPayload = {
  success?: boolean;
  queued?: boolean;
  requestId?: string;
  message?: string;
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

function CheckoutResultPageContent() {
  const searchParams = useSearchParams();
  const { clearCart, theme } = useStorefront();
  const isDark = theme === "dark";
  const verifiedQueryRef = useRef("");
  const finalizingTxnRef = useRef("");

  const [result, setResult] = useState<ReturnPayload | null>(null);
  const [error, setError] = useState("");
  const [hasBroadcastSuccess, setHasBroadcastSuccess] = useState(false);
  const [isFinalizingOrder, setIsFinalizingOrder] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [queueState, setQueueState] = useState<QueueTrackingState>("idle");
  const [queueMessage, setQueueMessage] = useState("");
  const [matchedNotification, setMatchedNotification] = useState<NotificationApiItem | null>(null);

  useEffect(() => {
    async function verifyPayment() {
      const query = searchParams.toString();
      if (!query) {
        setError("Không nhận được dữ liệu phản hồi từ VNPay.");
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
          throw new Error(payload?.message || "Không thể xác minh kết quả thanh toán.");
        }

        setResult(payload);
      } catch (verificationError) {
        verifiedQueryRef.current = "";
        setError(verificationError instanceof Error ? verificationError.message : "Không thể xác minh kết quả thanh toán.");
      }
    }

    void verifyPayment();
  }, [searchParams]);

  useEffect(() => {
    if (!result?.txnRef) {
      return;
    }

    const savedRequestId = window.sessionStorage.getItem(getPendingOrderRequestKey(result.txnRef));
    if (savedRequestId) {
      setRequestId(savedRequestId);
      setQueueState("polling");
    }
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
          title: "Thanh toán thành công",
          message: `Giao dịch ${result.txnRef} đã được xác nhận với số tiền ${formatCurrency(result.amount)}.`,
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
    async function finalizeSuccessfulCheckout() {
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

      if (finalizingTxnRef.current === result.txnRef) {
        return;
      }

      const rawPendingCheckout = window.localStorage.getItem(pendingCheckoutStorageKey);
      if (!rawPendingCheckout) {
        window.localStorage.removeItem(cartStorageKey);
        clearCart();
        return;
      }

      let pendingCheckout: { requestId?: string; items?: Array<{ productId: string; quantity: number }> } | null = null;
      try {
        pendingCheckout = JSON.parse(rawPendingCheckout) as { items?: Array<{ productId: string; quantity: number }> };
      } catch {
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        return;
      }

      if (!pendingCheckout?.items?.length) {
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        window.localStorage.removeItem(cartStorageKey);
        clearCart();
        return;
      }

      const session = readAuthSession();
      if (!session?.idToken) {
        setError("Thanh toán đã thành công nhưng chưa thể tạo đơn hàng vì phiên đăng nhập không còn. Hãy đăng nhập lại để kiểm tra.");
        return;
      }

      setIsFinalizingOrder(true);
      finalizingTxnRef.current = result.txnRef;
      setQueueState("idle");
      setQueueMessage("");

      try {
        const response = await fetch("/api/lambda-proxy/api/storefront/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.idToken}`
          },
          body: JSON.stringify({
            requestId: String(pendingCheckout.requestId ?? "").trim() || undefined,
            items: pendingCheckout.items
          })
        });

        const payload = (await response.json().catch(() => null)) as FinalizeOrderPayload | null;
        if (!response.ok || !payload?.requestId) {
          throw new Error(payload?.message || "Không thể tạo đơn hàng sau khi thanh toán thành công.");
        }

        window.sessionStorage.setItem(processedKey, "1");
        window.sessionStorage.setItem(getPendingOrderRequestKey(result.txnRef), payload.requestId);
        window.localStorage.removeItem(cartStorageKey);
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        clearCart();

        setRequestId(payload.requestId);
        setQueueState("polling");
        setQueueMessage(payload.message || "Đơn hàng đã được đưa vào queue để xử lý.");
      } catch (finalizeError) {
        setError(finalizeError instanceof Error ? finalizeError.message : "Không thể tạo đơn hàng sau thanh toán.");
      } finally {
        finalizingTxnRef.current = "";
        setIsFinalizingOrder(false);
      }
    }

    void finalizeSuccessfulCheckout();
  }, [clearCart, result]);

  useEffect(() => {
    if (!requestId || !result?.txnRef || queueState === "done" || queueState === "failed") {
      return;
    }

    const session = readAuthSession();
    if (!session?.idToken) {
      return;
    }

    let cancelled = false;

    async function pollQueueResult() {
      try {
        const response = await fetch("/api/lambda-proxy/api/notifications/me", {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("Không thể kiểm tra trạng thái xử lý đơn hàng.");
        }

        const payload = (await response.json()) as { items?: NotificationApiItem[] };
        const notification = (payload.items ?? []).find((item) => String(item.metadata?.requestId ?? "") === requestId);

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

        setQueueState("done");
        setQueueMessage(notification.message);
        window.sessionStorage.removeItem(getPendingOrderRequestKey(result.txnRef));
      } catch (pollError) {
        if (!cancelled) {
          setQueueMessage(pollError instanceof Error ? pollError.message : "Không thể kiểm tra trạng thái queue lúc này.");
        }
      }
    }

    void pollQueueResult();
    const intervalId = window.setInterval(() => {
      void pollQueueResult();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [queueState, requestId, result?.txnRef]);

  const isSuccess = result?.transactionStatus === "success" && result.isValidSignature;
  const shouldShowQueueNotification =
    Boolean(matchedNotification) &&
    (queueState !== "done" || matchedNotification?.message !== queueMessage);

  const queuePanel = useMemo<QueuePanel | null>(() => {
    if (!isSuccess || !requestId) {
      return null;
    }

    if (queueState === "polling" || isFinalizingOrder) {
      return {
        tone: isDark ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-100" : "border-cyan-200 bg-cyan-50 text-cyan-800",
        badge: "Đang xử lý",
        title: "Đơn hàng đang được đồng bộ",
        message: queueMessage || "Yêu cầu đã vào queue. Hệ thống đang theo dõi trạng thái để hoàn tất đơn hàng."
      };
    }

    if (queueState === "done") {
      return {
        tone: isDark ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-800",
        badge: "Hoàn tất",
        title: "Đơn hàng đã được ghi nhận",
        message: queueMessage || "Queue đã xử lý xong và hệ thống đã tạo đơn hàng thành công."
      };
    }

    if (queueState === "failed") {
      return {
        tone: isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800",
        badge: "Cần kiểm tra",
        title: "Đơn hàng chưa hoàn tất",
        message: queueMessage || "Queue đã phản hồi nhưng đơn hàng chưa thể xử lý trọn vẹn."
      };
    }

    return {
      tone: isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-800",
      badge: "Đã tiếp nhận",
      title: "Hệ thống đang tạo yêu cầu đơn hàng",
      message: queueMessage || "Yêu cầu đã được ghi nhận. Hệ thống đang chuẩn bị kiểm tra trạng thái queue."
    };
  }, [isDark, isFinalizingOrder, isSuccess, queueMessage, queueState, requestId]);

  return (
    <main className="px-4 py-12 sm:px-6 lg:px-8">
      <div
        className={`mx-auto max-w-3xl rounded-[2rem] border p-8 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.25)] ${
          isDark ? "border-white/10 bg-[#101826] text-white" : "border-slate-200 bg-white text-slate-950"
        }`}
      >
        <p className={`text-xs font-semibold uppercase tracking-[0.28em] ${isSuccess ? "text-emerald-500" : "text-orange-500"}`}>
          {isSuccess ? "Thanh toán thành công" : "Kết quả giao dịch"}
        </p>
        <h1 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>
          {result ? result.message : error || "Đang xác minh thanh toán..."}
        </h1>
        <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
          {isSuccess
            ? "Sau khi VNPay sandbox xác nhận thành công, hệ thống sẽ đẩy yêu cầu tạo đơn vào queue rồi tự kiểm tra lại trạng thái để hoàn tất đơn hàng."
            : "Nếu bạn vừa hủy giao dịch hoặc gặp lỗi, bạn có thể quay lại cửa hàng và thử lại bất cứ lúc nào."}
        </p>

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
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Mã giao dịch cửa hàng</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.txnRef || "--"}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Số tiền</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(result.amount)}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Ngân hàng</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.bankCode || "--"}</p>
            </div>
            <div>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Mã phản hồi</p>
              <p className={`mt-1 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{result.responseCode || "--"}</p>
            </div>
          </div>
        ) : null}

        {shouldShowQueueNotification && matchedNotification ? (
          <div className={`mt-6 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50/75"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Thông báo từ queue</p>
            <h2 className={`mt-3 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{matchedNotification.title}</h2>
            <p className={`mt-2 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{matchedNotification.message}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/store/products" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
            Tiếp tục mua sắm
          </Link>
          <Link
            href="/store/orders"
            className={`rounded-full px-5 py-3 text-sm font-semibold ${
              isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
            }`}
          >
            Xem lịch sử mua hàng
          </Link>
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
