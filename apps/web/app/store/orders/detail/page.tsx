"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useStorefront } from "../../store-client";
import { fetchOrderDetails } from "../../store-api";
import type { StoreOrder } from "../../store-types";
import { formatCurrency } from "../../store-utils";

const statusLabels: Record<string, string> = {
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  pending: "Đang xử lý",
  done: "Hoàn tất",
  cancelled: "Đã hủy",
  expired: "Đã hết hạn",
  payment_failed: "Thanh toán không thành công"
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function OrderDetailContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId")?.trim() ?? "";
  const { session, theme, openAuthModal } = useStorefront();
  const isDark = theme === "dark";
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

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
      (result) => { if (!cancelled) setOrder(result); },
      (cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Không thể tải đơn hàng."); }
    ).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, session?.accessToken]);

  const originalTotal = order && order.items.every((item) => typeof item.originalUnitPrice === "number")
    ? order.items.reduce((sum, item) => sum + Math.max(item.price, item.originalUnitPrice!) * item.quantity, 0)
    : undefined;
  const savings = order && originalTotal !== undefined && originalTotal > order.totalAmount
    ? originalTotal - order.totalAmount
    : 0;
  const panelClass = isDark ? "border-white/10 bg-[#101826] text-white" : "border-slate-200 bg-white text-slate-950";

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/store/orders" className={`text-sm font-semibold ${isDark ? "text-orange-300" : "text-orange-700"}`}>← Lịch sử đơn hàng</Link>
        <div className={`mt-5 rounded-3xl border p-6 shadow-sm sm:p-8 ${panelClass}`}>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500">NovaX Market</p>
          <h1 className="mt-2 text-3xl font-bold">Chi tiết đơn hàng</h1>

          {!orderId ? <p className="mt-6 text-sm">Link đơn hàng không hợp lệ.</p> : null}
          {orderId && !session ? (
            <div className="mt-6">
              <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>Đăng nhập bằng tài khoản đã đặt hàng để xem bill và trạng thái đơn.</p>
              <button type="button" onClick={() => openAuthModal(`/store/orders/detail?orderId=${encodeURIComponent(orderId)}`)} className="mt-4 rounded-full bg-orange-600 px-5 py-3 text-sm font-semibold text-white">Đăng nhập để xem đơn</button>
            </div>
          ) : null}
          {orderId && session && isLoading ? <p role="status" className="mt-6 text-sm">Đang tải đơn hàng…</p> : null}
          {orderId && session && !isLoading && error ? <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : null}

          {order ? (
            <>
              <div className={`mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 ${isDark ? "bg-white/5" : "bg-orange-50"}`}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-500">Trạng thái</p>
                  <p className="mt-1 font-bold">{statusLabels[order.status] ?? order.status}</p>
                </div>
                <div className="text-sm">
                  <p>Đặt hàng: <strong>{formatDateTime(order.createdAt)}</strong></p>
                  {order.paymentConfirmedAt ? <p className="mt-1">Xác nhận thanh toán: <strong>{formatDateTime(order.paymentConfirmedAt)}</strong></p> : null}
                </div>
              </div>

              <div className="mt-7 space-y-4">
                <h2 className="text-lg font-bold">Sản phẩm đã đặt</h2>
                {order.items.map((item) => {
                  const hasDiscount = typeof item.originalUnitPrice === "number" && item.originalUnitPrice > item.price;
                  return (
                    <div key={item.productId} className={`flex flex-wrap justify-between gap-3 border-b pb-4 ${isDark ? "border-white/10" : "border-slate-200"}`}>
                      <div>
                        <p className="font-semibold">{item.productName}</p>
                        <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>Số lượng: {item.quantity}</p>
                      </div>
                      <div className="text-right text-sm">
                        {hasDiscount ? <p className="text-slate-400 line-through">{formatCurrency(item.originalUnitPrice!)} / sản phẩm</p> : null}
                        <p>{formatCurrency(item.price)} / sản phẩm</p>
                        <p className="mt-1 font-bold">Thành tiền: {formatCurrency(item.lineTotal)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 text-right">
                {savings > 0 ? <>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>Giá trước giảm: {formatCurrency(originalTotal!)}</p>
                  <p className="mt-1 text-sm text-emerald-600">Đã giảm: -{formatCurrency(savings)}</p>
                </> : null}
                <p className="mt-3 text-sm">Tổng giá trị đơn hàng</p>
                <p className="mt-1 text-3xl font-bold text-orange-600">{formatCurrency(order.totalAmount)}</p>
              </div>
              <p className={`mt-7 break-all rounded-xl p-3 text-xs ${isDark ? "bg-white/5 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
                Mã đơn hàng để tra cứu/hỗ trợ: {order.id}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  return <Suspense fallback={<main className="p-8" role="status">Đang tải đơn hàng…</main>}><OrderDetailContent /></Suspense>;
}
