"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { readAuthSession } from "../../lib/cognito-auth";
import { useStorefront } from "../store-client";
import { fetchMyOrders } from "../store-api";
import type { StoreOrder } from "../store-types";
import { formatCurrency, formatDateTime, formatShortDate } from "../store-utils";

type ProfileMetricCardProps = {
  label: string;
  value: string;
  tone?: "warm" | "cool" | "neutral";
  isDark: boolean;
};

function ProfileMetricCard({ label, value, tone = "neutral", isDark }: ProfileMetricCardProps) {
  const toneClassName = isDark
    ? tone === "warm"
      ? "border-orange-500/20 from-orange-500/10 to-rose-500/5"
      : tone === "cool"
        ? "border-cyan-500/20 from-cyan-500/10 to-blue-500/5"
        : "border-white/10 from-white/10 to-white/5"
    : tone === "warm"
      ? "border-orange-200 from-orange-500/12 to-rose-500/12"
      : tone === "cool"
        ? "border-cyan-200 from-cyan-500/12 to-blue-500/12"
        : "border-slate-200 from-slate-200/30 to-white";

  return (
    <article className={`rounded-[1.75rem] border bg-gradient-to-br p-5 ${toneClassName}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <strong className={`mt-3 block text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}

function ProfileSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div
            className={`grid gap-8 rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] ${
              isDark ? "bg-[#101826]" : "bg-white"
            }`}
          >
            <div className="grid gap-4">
              <div className={`h-4 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-12 w-4/5 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className="mt-3 flex flex-wrap gap-3">
                <div className={`h-11 w-36 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-11 w-32 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
            </div>

            <div className={`rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center gap-4">
                <div className={`h-20 w-20 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className="grid flex-1 gap-3">
                  <div className={`h-5 w-40 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-4 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              </div>
              <div className="mt-6 grid gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`h-12 rounded-2xl ${isDark ? "bg-white/5" : "bg-white"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={`h-32 rounded-[1.75rem] border ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`} />
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className={`rounded-[1.75rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className={`h-7 w-52 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className="mt-6 grid gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-100"}`}>
                  <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-3 h-5 w-40 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-2 h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-[1.75rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className={`h-7 w-48 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className="mt-6 grid gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-100"}`}>
                  <div className={`h-4 w-20 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-3 h-5 w-48 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-2 h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function makeInitials(name: string, email: string) {
  const parts = String(name || email)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "NX";
}

const avatarStoragePrefix = "web-storefront-avatar-";
  const avatarUploadEndpoint = "/api/lambda-proxy/api/uploads/avatar/presign";

function avatarStorageKey(email: string) {
  return `${avatarStoragePrefix}${email.trim().toLowerCase()}`;
}

export default function StoreProfilePage() {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  const [session, setSession] = useState<ReturnType<typeof readAuthSession>>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentSession = readAuthSession();
    setSession(currentSession);
    setAvatarUrl(currentSession ? window.localStorage.getItem(avatarStorageKey(currentSession.email)) ?? "" : "");

    let cancelled = false;

    async function loadOrders() {
      if (!currentSession) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const data = await fetchMyOrders();
        if (!cancelled) {
          setOrders(data);
          setError("");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Không thể tải thông tin hồ sơ.");
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

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const totalSpend = orders.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0);
    const totalItems = orders.reduce((sum, order) => sum + order.items.reduce((inner, item) => inner + Number(item.quantity ?? 0), 0), 0);
    const lastOrder = orders[0] ?? null;

    return {
      totalOrders,
      totalSpend,
      totalItems,
      lastOrder
    };
  }, [orders]);

  const recentOrders = orders.slice(0, 4);

  async function uploadAvatar(file: File | undefined) {
    if (!file || !session) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Please choose a JPG, PNG, or WebP image up to 5 MB.");
      return;
    }

    setIsUploadingAvatar(true);
    setError("");
    try {
      const presignResponse = await fetch(avatarUploadEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.idToken}`
        },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, scope: "avatars" })
      });
      const presign = await presignResponse.json().catch(() => null) as { uploadUrl?: string; fileUrl?: string; message?: string } | null;
      if (!presignResponse.ok || !presign?.uploadUrl || !presign.fileUrl) {
        throw new Error(presign?.message || "Could not prepare avatar upload.");
      }

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });
      if (!uploadResponse.ok) throw new Error("Could not upload avatar to S3.");

      window.localStorage.setItem(avatarStorageKey(session.email), presign.fileUrl);
      setAvatarUrl(presign.fileUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload avatar.");
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  if (isLoading) {
    return <ProfileSkeleton isDark={isDark} />;
  }

  if (!session) {
    return (
      <main className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div className={`rounded-[calc(2rem-1px)] px-6 py-10 text-center sm:px-8 ${isDark ? "bg-[#101826] text-white" : "bg-white text-slate-950"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Hồ sơ cá nhân</p>
            <h1 className={`mt-4 text-4xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Đăng nhập để mở hồ sơ của bạn</h1>
            <p className={`mx-auto mt-4 max-w-2xl text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              Khi đăng nhập, bạn sẽ xem được thông tin tài khoản, thống kê chi tiêu và các đơn hàng gần đây ngay trong storefront.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/admin" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
                Đăng nhập ngay
              </Link>
              <Link
                href="/store/products"
                className={`rounded-full px-5 py-3 text-sm font-semibold ${
                  isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                }`}
              >
                Xem sản phẩm trước
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const initials = makeInitials(session.name, session.email);
  const memberSince = formatShortDate(new Date(session.expiresAt - 1000 * 60 * 60 * 24 * 30).toISOString());

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div
            className={`grid gap-8 rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] ${
              isDark ? "bg-[#101826] text-white" : "bg-white text-slate-950"
            }`}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Your Profile</p>
              <h1 className={`mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl ${isDark ? "text-white" : "text-slate-950"}`}>
                {session.name || "Người dùng NovaX"}, welcome back!
              </h1>
              <p className={`mt-5 max-w-2xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                This page aggregates login information from Cognito along with actual purchase statistics from the storefront so you can quickly view the status of your account.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/store/orders" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
                  View Order History
                </Link>
                <Link
                  href="/store/products"
                  className={`rounded-full px-5 py-3 text-sm font-semibold ${
                    isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                  }`}
                >
                  Continue Shopping
                </Link>
              </div>
            </div>

            <aside
              className={`rounded-[1.75rem] border p-5 shadow-[0_24px_80px_-64px_rgba(15,23,42,0.4)] ${
                isDark
                  ? "border-white/10 bg-[linear-gradient(180deg,_rgba(15,23,42,0.96)_0%,_rgba(30,41,59,0.9)_100%)]"
                  : "border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,1)_0%,_rgba(255,247,237,0.92)_100%)]"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <div className="h-28 w-28 overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-orange-500 to-pink-500 text-3xl font-bold tracking-[0.18em] text-white shadow-[0_18px_40px_-22px_rgba(249,115,22,0.85)]">
                    {avatarUrl ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center">{initials}</div>}
                  </div>
                  <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${isDark ? "bg-white/10 text-white" : "bg-slate-900 text-white"} disabled:opacity-60`}>
                    {isUploadingAvatar ? "Uploading" : "Change photo"}
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
                </div>
                <div className="min-w-0">
                  <p className={`truncate text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{session.name}</p>
                  <p className={`truncate text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{session.email}</p>
                  <span
                    className={`mt-2 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      session.role === "admin"
                        ? isDark
                          ? "bg-cyan-500/15 text-cyan-300"
                          : "bg-cyan-100 text-cyan-700"
                        : isDark
                          ? "bg-orange-500/15 text-orange-300"
                          : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {session.role === "admin" ? "Quản trị viên" : "Khách hàng"}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Login Source</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>Cognito Login Session</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Current Session</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>Expires at {formatDateTime(new Date(session.expiresAt).toISOString())}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Status</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>Active and ready to place orders</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Member Since</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>Current summary, updated until {memberSince}</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ProfileMetricCard label="Total Orders" value={String(stats.totalOrders)} tone="warm" isDark={isDark} />
          <ProfileMetricCard label="Total Spent" value={formatCurrency(stats.totalSpend)} tone="cool" isDark={isDark} />
          <ProfileMetricCard label="Total Products Purchased" value={String(stats.totalItems)} tone="neutral" isDark={isDark} />
          <ProfileMetricCard label="Latest Order" value={stats.lastOrder ? formatShortDate(stats.lastOrder.createdAt) : "None"} tone="neutral" isDark={isDark} />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className={`rounded-[1.75rem] border p-6 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.24)] ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Summary</p>
            <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Account Profile</h2>
            <div className="mt-6 grid gap-4">
              <article className={`rounded-[1.5rem] border px-4 py-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Display Name</p>
                <p className={`mt-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{session.name}</p>
              </article>
              <article className={`rounded-[1.5rem] border px-4 py-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Email login</p>
                <p className={`mt-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{session.email}</p>
              </article>
              <article className={`rounded-[1.5rem] border px-4 py-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Current Role</p>
                <p className={`mt-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{session.role === "admin" ? "Administrator" : "Customer"}</p>
              </article>
              <article className={`rounded-[1.5rem] border px-4 py-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Shopping Habits</p>
                <p className={`mt-2 text-base leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  {stats.totalOrders >= 5
                    ? "You have a fairly stable purchase frequency, making you a great candidate for tracking deals and updating orders directly in the storefront."
                    : "You are in the initial stage, so this profile page prioritizes displaying concise, easy-to-read information and encourages quick return visits for shopping."}
                </p>
              </article>
            </div>
          </div>

          <div className={`rounded-[1.75rem] border p-6 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.24)] ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Recent Orders</p>
                <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Latest Purchase Activity</h2>
              </div>
              <Link
                href="/store/orders"
                className={`rounded-full px-5 py-3 text-sm font-semibold ${
                  isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                }`}
              >
                View Order History
              </Link>
            </div>

            {error ? (
              <div className={`mt-6 rounded-[1.5rem] border px-4 py-4 text-sm ${isDark ? "border-rose-500/20 bg-rose-500/10 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                {error}
              </div>
            ) : recentOrders.length === 0 ? (
              <div
                className={`mt-6 rounded-[1.5rem] border border-dashed px-4 py-8 text-sm ${
                  isDark ? "border-white/10 bg-white/5 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                You haven't placed any orders yet as of August 18, 2026. Try purchasing a few products to make this profile more dynamic.
              </div>
            ) : (
              <div className="mt-6 grid gap-4">
                {recentOrders.map((order) => (
                  <article
                    key={order.id}
                    className={`rounded-[1.5rem] border px-4 py-4 ${
                      isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Order ID {order.id.slice(0, 8)}</p>
                        <h3 className={`mt-2 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{order.items.length} product lines</h3>
                        <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Created at {formatDateTime(order.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(order.totalAmount)}</p>
                        <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{order.status}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
