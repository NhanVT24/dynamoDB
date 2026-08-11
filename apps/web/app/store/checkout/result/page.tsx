"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readAuthSession } from "../../../lib/cognito-auth";
import { useStorefront } from "../../store-client";
import { formatCurrency } from "../../../store/store-utils";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const localNotificationsStorageKey = "web-storefront-local-notifications";
const notificationsUpdatedEvent = "storefront-notifications-updated";
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";
const cartStorageKey = "web-storefront-cart";
const processedPaymentPrefix = "web-storefront-payment-processed-";

type ReturnPayload = {
  isValidSignature: boolean;
  transactionStatus: "success" | "failed";
  message: string;
  txnRef: string;
  amount: number;
  orderInfo: string;
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
};

export default function CheckoutResultPage() {
  const searchParams = useSearchParams();
  const { clearCart } = useStorefront();
  const [result, setResult] = useState<ReturnPayload | null>(null);
  const [error, setError] = useState("");
  const [hasBroadcastSuccess, setHasBroadcastSuccess] = useState(false);
  const [isFinalizingOrder, setIsFinalizingOrder] = useState(false);

  useEffect(() => {
    async function verifyPayment() {
      if (!apiBaseUrl) {
        setError("Thiếu NEXT_PUBLIC_API_URL để kiểm tra trạng thái thanh toán.");
        return;
      }

      const query = searchParams.toString();
      if (!query) {
        setError("Không nhận được dữ liệu phản hồi từ VNPay.");
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/payments/vnpay/return?${query}`, {
          cache: "no-store"
        });
        const payload = await response.json().catch(() => null) as ReturnPayload | null;

        if (!response.ok || !payload) {
          throw new Error("Không thể xác minh kết quả thanh toán.");
        }

        setResult(payload);
      } catch (verificationError) {
        setError(verificationError instanceof Error ? verificationError.message : "Không thể xác minh kết quả thanh toán.");
      }
    }

    void verifyPayment();
  }, [searchParams]);

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
      const current = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
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
          createdAt: new Date().toISOString()
        });
        window.localStorage.setItem(localNotificationsStorageKey, JSON.stringify(current));
        window.dispatchEvent(new Event(notificationsUpdatedEvent));
      }

      setHasBroadcastSuccess(true);
    } catch {}
  }, [hasBroadcastSuccess, result]);

  useEffect(() => {
    async function finalizeSuccessfulCheckout() {
      if (!result || !apiBaseUrl) {
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

      let pendingCheckout: { items?: Array<{ productId: string; quantity: number }> } | null = null;
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

      try {
        const response = await fetch(`${apiBaseUrl}/api/storefront/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.idToken}`
          },
          body: JSON.stringify({
            items: pendingCheckout.items
          })
        });

        const payload = await response.json().catch(() => null) as { message?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Không thể tạo đơn hàng sau khi thanh toán thành công.");
        }

        window.sessionStorage.setItem(processedKey, "1");
        window.localStorage.removeItem(cartStorageKey);
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        clearCart();
      } catch (finalizeError) {
        setError(finalizeError instanceof Error ? finalizeError.message : "Không thể tạo đơn hàng sau thanh toán.");
      } finally {
        setIsFinalizingOrder(false);
      }
    }

    void finalizeSuccessfulCheckout();
  }, [clearCart, result]);

  const isSuccess = result?.transactionStatus === "success" && result.isValidSignature;

  return (
    <main className="px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.25)]">
        <p className={`text-xs font-semibold uppercase tracking-[0.28em] ${isSuccess ? "text-emerald-600" : "text-orange-500"}`}>
          {isSuccess ? "Thanh toán thành công" : "Kết quả giao dịch"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          {result ? result.message : error || "Đang xác minh thanh toán..."}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {isSuccess
            ? "Đơn hàng demo đã được VNPay sandbox phản hồi thành công. Bạn có thể tiếp tục mua sắm hoặc quay lại giỏ hàng để kiểm tra."
            : "Nếu bạn vừa hủy giao dịch hoặc gặp lỗi, bạn có thể quay lại cửa hàng và thử lại bất cứ lúc nào."}
        </p>

        {isSuccess && isFinalizingOrder ? (
          <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
            Đang ghi nhận đơn hàng và xóa giỏ hàng sau thanh toán...
          </div>
        ) : null}

        {error ? (
          <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${isSuccess ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="mt-8 grid gap-4 rounded-[1.5rem] bg-slate-50 p-5 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-500">Mã giao dịch cửa hàng</p>
              <p className="mt-1 font-semibold text-slate-950">{result.txnRef || "--"}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Số tiền</p>
              <p className="mt-1 font-semibold text-slate-950">{formatCurrency(result.amount)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Ngân hàng</p>
              <p className="mt-1 font-semibold text-slate-950">{result.bankCode || "--"}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Mã phản hồi</p>
              <p className="mt-1 font-semibold text-slate-950">{result.responseCode || "--"}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/store/products" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
            Tiếp tục mua sắm
          </Link>
          <Link href="/store/checkout" className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">
            Quay lại thanh toán
          </Link>
        </div>
      </div>
    </main>
  );
}
