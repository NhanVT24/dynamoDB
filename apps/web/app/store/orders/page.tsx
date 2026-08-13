"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMyOrders } from "../store-api";
import type { StoreOrder } from "../store-types";
import { formatCurrency, formatDateTime } from "../store-utils";

type PaginationToken = number | "ellipsis";

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = String(status).toLowerCase();
  const isPending = normalizedStatus === "pending";
  const isFailed = normalizedStatus === "failed";

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
        isPending
          ? "bg-amber-100 text-amber-700"
          : isFailed
            ? "bg-rose-100 text-rose-700"
            : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {status}
    </span>
  );
}

function buildPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([
    1,
    2,
    totalPages - 1,
    totalPages,
    Math.max(1, currentPage - 1),
    currentPage,
    Math.min(totalPages, currentPage + 1)
  ]);

  const sortedPages = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const tokens: PaginationToken[] = [];

  for (const page of sortedPages) {
    const previous = tokens[tokens.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      tokens.push("ellipsis");
    }
    tokens.push(page);
  }

  return tokens;
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      try {
        const data = await fetchMyOrders();
        if (!cancelled) {
          setOrders(data);
          setError("");
          setPage(1);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Không thể tải lịch sử mua hàng.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = orders.slice((safePage - 1) * pageSize, safePage * pageSize);
  const paginationTokens = buildPaginationTokens(safePage, totalPages);

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div className="rounded-[calc(2rem-1px)] bg-white px-6 py-8 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Lịch sử mua hàng</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Theo dõi toàn bộ đơn đã đặt</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Xem lại các đơn đã tạo, thời điểm mua, trạng thái hiện tại và chi tiết từng sản phẩm trong đơn hàng của bạn.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/store/products" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
                Tiếp tục mua sắm
              </Link>
              <Link href="/store/checkout" className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">
                Tới thanh toán
              </Link>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-8 rounded-[1.75rem] border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
            Đang tải lịch sử đơn hàng...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-[1.75rem] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            {error}
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-8 rounded-[1.75rem] border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
            Bạn chưa có đơn hàng nào tính đến ngày 12 tháng 8 năm 2026.
          </div>
        ) : (
          <div className="mt-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                Hiển thị <span className="font-semibold text-slate-950">{paginatedOrders.length}</span> / <span className="font-semibold text-slate-950">{orders.length}</span> đơn hàng
              </p>
              <p className="text-sm text-slate-500">
                Trang <span className="font-semibold text-slate-950">{safePage}</span> / <span className="font-semibold text-slate-950">{totalPages}</span>
              </p>
            </div>
            <div className="grid gap-5">
              {paginatedOrders.map((order) => (
                <article key={order.id} className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.25)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Mã đơn {order.id.slice(0, 8)}</p>
                      <h2 className="mt-3 text-2xl font-semibold text-slate-950">{order.items.length} dòng sản phẩm</h2>
                      <p className="mt-2 text-sm text-slate-500">Đặt lúc {formatDateTime(order.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={order.status} />
                      <p className="mt-3 text-2xl font-bold text-slate-950">{formatCurrency(order.totalAmount)}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {order.items.map((item) => (
                      <div key={`${order.id}-${item.productId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                        <div>
                          <p className="font-semibold text-slate-950">{item.productName}</p>
                          <p className="mt-1 text-sm text-slate-500">SL {item.quantity} x {formatCurrency(item.price)}</p>
                        </div>
                        <strong className="text-slate-950">{formatCurrency(item.lineTotal)}</strong>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
                className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage <= 1 ? "cursor-not-allowed bg-slate-200 text-slate-400" : "bg-white text-slate-950 shadow-sm"}`}
              >
                Trang trước
              </button>
              {paginationTokens.map((token, index) =>
                token === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-sm font-semibold text-slate-500">...</span>
                ) : (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setPage(token)}
                    className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${token === safePage ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : "bg-white text-slate-700 shadow-sm"}`}
                  >
                    {token}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage >= totalPages}
                className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage >= totalPages ? "cursor-not-allowed bg-slate-200 text-slate-400" : "bg-gradient-to-r from-orange-500 to-red-500 text-white"}`}
              >
                Trang sau
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
