"use client";

import { useState } from "react";
import { readAuthSession } from "../../lib/cognito-auth";
import { useStorefront } from "../store-client";
import { formatCurrency } from "../store-utils";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";

export default function CheckoutPage() {
  const { items, subtotal, shipping, total } = useStorefront();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleCheckout() {
    if (items.length === 0) {
      setError("Giỏ hàng đang trống, bạn hãy chọn thêm sản phẩm trước khi thanh toán.");
      return;
    }

    if (!apiBaseUrl) {
      setError("Thiếu NEXT_PUBLIC_API_URL để khởi tạo thanh toán.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const session = readAuthSession();
      const response = await fetch(`${apiBaseUrl}/api/payments/vnpay/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: session?.email,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          })),
          orderDescription: `Thanh toán ${items.length} sản phẩm tại NovaX Market`,
          locale: "vn"
        })
      });

      const payload = await response.json().catch(() => null) as { paymentUrl?: string; message?: string } | null;

      if (!response.ok || !payload?.paymentUrl) {
        throw new Error(payload?.message || "Không thể tạo liên kết thanh toán VNPay.");
      }

      window.localStorage.setItem(pendingCheckoutStorageKey, JSON.stringify({
        email: session?.email ?? "",
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        createdAt: new Date().toISOString()
      }));

      window.location.assign(payload.paymentUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Không thể chuyển sang cổng thanh toán VNPay.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.25)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Checkout</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Thanh toán với VNPay Sandbox</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Bạn sẽ được chuyển sang cổng thanh toán VNPay để hoàn tất giao dịch demo. Sau khi thanh toán xong,
            hệ thống sẽ đưa bạn quay lại trang kết quả ngay trong website.
          </p>

          <div className="mt-8 space-y-4">
            {items.map((item) => (
              <article key={item.variantId} className="flex gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <img src={item.image} alt={item.productName} className="h-20 w-20 rounded-3xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="line-clamp-2 text-base font-semibold text-slate-950">{item.productName}</h2>
                      <p className="mt-1 text-sm text-slate-500">{item.variantName}</p>
                    </div>
                    <strong className="text-sm font-semibold text-slate-950">{formatCurrency(item.price * item.quantity)}</strong>
                  </div>
                  <p className="mt-3 text-sm text-slate-500">Số lượng: {item.quantity}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.5)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-300">Tóm tắt đơn hàng</p>
          <div className="mt-6 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Tạm tính</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Phí vận chuyển</span>
              <span>{shipping === 0 ? "Miễn phí" : formatCurrency(shipping)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/15 pt-4 text-lg font-semibold">
              <span>Tổng thanh toán</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] bg-white/8 p-4 text-sm leading-7 text-slate-200">
            <p>Dùng thẻ test NCB của VNPay sandbox để mô phỏng giao dịch.</p>
            <p className="mt-2">Sau khi hoàn tất, bạn sẽ được trả về trang kết quả thanh toán của cửa hàng.</p>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={isSubmitting || items.length === 0}
            className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Đang chuyển sang VNPay..." : "Thanh toán ngay"}
          </button>
        </aside>
      </div>
    </main>
  );
}
