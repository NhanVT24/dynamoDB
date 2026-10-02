"use client";
import { getIntlLocale, t, translateLabel } from "../../../i18n/language";

import { useLanguage } from "../../../i18n/LanguageProvider";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import ShoppingManager from "../components/ShoppingManager";
import EmailCenter from "../components/EmailCenter";
import StorageManager from "../components/StorageManager";
import UserPermissionManager from "../components/UserPermissionManager";
import AuditWorkspace from "../components/AuditWorkspace";
import { LanguageSwitcher } from "../../../i18n/LanguageSwitcher";
import {
  clearAuthSession,
  rememberPostLoginRedirect,
  authSessionChangedEvent,
  authenticatedFetch,
  apiUrl,
  type AuthSession,
  readAuthSession,
  signOutFromCognitoHostedUi
} from "../../auth/lib/cognito-auth";

type AdminNotification = {
  id: string;
  title: string;
  message: string;
  status?: "pending" | "sent" | "read";
  isRead?: boolean;
  createdAt?: string;
  metadata?: {
    alertLevel?: string;
    productName?: string;
    stock?: number;
    [key: string]: unknown;
  };
};

function formatNotificationTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function AdminNotificationBell({ authToken }: { authToken: string }) {
  useLanguage();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const response = await authenticatedFetch(apiUrl("/api/notifications/me"), {
          headers: {
            Authorization: `Bearer ${authToken}`
          },
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json() as { items?: AdminNotification[]; pendingCount?: number };
        if (cancelled) {
          return;
        }

        setNotifications(payload.items ?? []);
        setPendingCount(Number(payload.pendingCount ?? 0));
      } catch {}
    }

    void loadNotifications();
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authToken]);

  useEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }

    function updatePanelPosition() {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const width = Math.min(448, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      setPanelStyle({
        top: rect.bottom + 12,
        left,
        width
      });
    }

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function markAsRead(id: string) {
    try {
      const response = await authenticatedFetch(apiUrl(`/api/notifications/${id}/read`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        return;
      }

      setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: true, status: "read" } : item));
      setPendingCount((current) => Math.max(0, current - 1));
    } catch {}
  }

  async function removeNotification(id: string, isRead: boolean) {
    try {
      const response = await authenticatedFetch(apiUrl(`/api/notifications/${id}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        return;
      }

      setNotifications((current) => current.filter((item) => item.id !== id));
      if (!isRead) {
        setPendingCount((current) => Math.max(0, current - 1));
      }
    } catch {}
  }

  async function clearAll() {
    if (notifications.length === 0) {
      return;
    }

    setBusy(true);
    try {
      const response = await authenticatedFetch(apiUrl("/api/notifications"), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        return;
      }

      setNotifications([]);
      setPendingCount(0);
    } catch {
    } finally {
      setBusy(false);
    }
  }

  async function markAllAsRead() {
    const unreadItems = notifications.filter((item) => !item.isRead);
    if (unreadItems.length === 0) {
      return;
    }

    setBusy(true);
    try {
      await Promise.all(unreadItems.map(async (item) => {
        await authenticatedFetch(apiUrl(`/api/notifications/${item.id}/read`), {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        });
      }));

      setNotifications((current) => current.map((item) => ({ ...item, isRead: true, status: "read" })));
      setPendingCount(0);
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-50">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
        aria-label={t("open admin notifications")}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18H5.5a1 1 0 0 1-.8-1.6l1.3-1.7V10a6 6 0 1 1 12 0v4.7l1.3 1.7a1 1 0 0 1-.8 1.6H15" />
          <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
        </svg>
        {pendingCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {pendingCount}
          </span>
        ) : null}
      </button>

      {open && panelStyle ? createPortal((
        <div
          ref={panelRef}
          className="fixed z-[200] rounded-[1.5rem] border border-slate-200 bg-white p-4 text-slate-950 shadow-2xl"
          style={{
            top: `${panelStyle.top}px`,
            left: `${panelStyle.left}px`,
            width: `${panelStyle.width}px`
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{t("Admin Notifications")}</p>
              <p className="text-xs text-slate-500">{pendingCount} {t("unread")}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy || pendingCount === 0}
                onClick={() => void markAllAsRead()}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
              >{t("Mark All as Read")}</button>
              <button
                type="button"
                disabled={busy || notifications.length === 0}
                onClick={() => void clearAll()}
                className="rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
              >{t("Clear all")}</button>
            </div>
          </div>

          <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {notifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{t("No notifications available for admin.")}</div>
            ) : notifications.map((item) => {
              const alertLevel = String(item.metadata?.alertLevel ?? "");
              const isCritical = alertLevel === "out_of_stock";
              return (
                <article
                  key={item.id}
                  className={`rounded-2xl border p-3 ${isCritical ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}
                >
                  <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${item.isRead ? "text-slate-500" : "text-slate-900"}`}>{translateLabel(item.title)}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {isCritical ? t("Out of Stock") : t("Low Inventory")} {item.createdAt ? `· ${formatNotificationTime(item.createdAt)}` : ""}
                      </p>
                    </div>
                    {!item.isRead ? <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{translateLabel(item.message)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!item.isRead ? (
                      <button
                        type="button"
                        onClick={() => void markAsRead(item.id)}
                        className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                      >{t("Mark as Read")}</button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void removeNotification(item.id, Boolean(item.isRead))}
                      className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100"
                    >{t("Delete")}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

export default function Home() {
  useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [adminTab, setAdminTab] = useState<"products" | "email" | "storage" | "permissions" | "audit">("products");
  useEffect(() => {
    const nextSession = readAuthSession();
    if (!nextSession) {
      clearAuthSession();
    }

    setSession(nextSession);
    setReady(true);
  }, []);

  useEffect(() => {
    if (searchParams.get("tab") === "audit") setAdminTab("audit");
  }, [searchParams]);

  useEffect(() => {
    function syncSession() {
      setSession(readAuthSession());
    }

    window.addEventListener(authSessionChangedEvent, syncSession);
    return () => {
      window.removeEventListener(authSessionChangedEvent, syncSession);
    };
  }, []);

  useEffect(() => {
    if (!ready || session) {
      return;
    }

    // Keep authentication in the storefront modal instead of rendering a standalone admin login page.
    rememberPostLoginRedirect(`/admin${window.location.search}`);
    router.replace("/store?auth=login");
  }, [ready, router, session]);

  useEffect(() => {
    if (!ready || !session || session.role === "admin") {
      return;
    }

    router.replace("/store");
  }, [ready, router, session]);

  if (!ready) {
    return null;
  }

  if (session?.role !== "admin") return null;

  return (
    <div className="grid gap-4">
      <ShoppingManager
          authToken={session.accessToken}
          canManageProducts={session.role === "admin"}
          currentUserSubject={session.subject}
          permissions={session.permissions}
          workspaceContent={adminTab === "email"
            ? <EmailCenter authToken={session.accessToken} />
            : adminTab === "storage"
              ? <StorageManager />
            : adminTab === "permissions"
              ? <UserPermissionManager />
            : adminTab === "audit"
              ? <AuditWorkspace key={session.subject} authToken={session.accessToken} />
              : null}
          tabNavigation={(
          <nav className="flex w-full flex-wrap justify-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <button type="button" onClick={() => setAdminTab("products")} className={`rounded-xl px-4 py-2 text-sm font-bold ${adminTab === "products" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t("Products")}</button>
          {session.role === "admin" ? <button type="button" onClick={() => setAdminTab("email")} className={`rounded-xl px-4 py-2 text-sm font-bold ${adminTab === "email" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t("Email Center")}</button> : null}
          {session.role === "admin" ? <button type="button" onClick={() => setAdminTab("storage")} className={`rounded-xl px-4 py-2 text-sm font-bold ${adminTab === "storage" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t("Storage")}</button> : null}
          {session.role === "admin" ? <button type="button" onClick={() => setAdminTab("permissions")} className={`rounded-xl px-4 py-2 text-sm font-bold ${adminTab === "permissions" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t("Permissions")}</button> : null}
          {session.role === "admin" ? <button type="button" onClick={() => setAdminTab("audit")} className={`rounded-xl px-4 py-2 text-sm font-bold ${adminTab === "audit" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t("Audit")}</button> : null}
          </nav>
          )}
          headerActions={(
            <div className="relative z-50 flex items-center gap-3">
              <LanguageSwitcher />
              <AdminNotificationBell authToken={session.accessToken} />
              <div className="hidden rounded-2xl bg-cyan-50 px-4 py-3 text-right ring-1 ring-cyan-200 md:block">
                <p className="text-sm font-semibold text-slate-900">{session.name}</p>
                <p className="text-xs text-slate-500">{session.email}</p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                  {session.role === "admin" ? t("Admin") : session.role === "customer" ? t("Customer") : t("Viewer")}
                </p>
              </div>
              <button
                type="button"
                onClick={signOutFromCognitoHostedUi}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >{t("Logout")}</button>
            </div>
          )}
        />
    </div>
  );
}
