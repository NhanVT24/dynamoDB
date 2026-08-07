"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "../../../store/store-utils";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

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
  const [result, setResult] = useState<ReturnPayload | null>(null);
  const [error, setError] = useState("");

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
