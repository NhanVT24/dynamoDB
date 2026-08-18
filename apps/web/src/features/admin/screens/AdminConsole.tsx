"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import ShoppingManager from "../components/ShoppingManager";
import {
  beginGoogleSignIn,
  clearAuthSession,
  confirmForgotPassword,
  confirmSignUpWithCognito,
  consumePostLoginRedirect,
  authSessionChangedEvent,
  type AuthSession,
  forgotPassword,
  readAuthSession,
  resendConfirmationCode,
  signInWithCognito,
  signOutLocally,
  signUpWithCognito
} from "../../auth/lib/cognito-auth";

type AuthMode = "login" | "register" | "confirm" | "forgot" | "reset";
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

const inputClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100";

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete = "current-password"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative z-50">
      <input
        className={`${inputClassName} pr-12`}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        title={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 3L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M10.58 10.58A2 2 0 0 0 13.41 13.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path
              d="M9.88 5.09A10.94 10.94 0 0 1 12 4.91C17 4.91 20.27 9.11 21 12c-.34 1.35-1.27 3.19-2.86 4.73"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6.61 6.61C4.62 8 3.36 10.11 3 12c.73 2.89 4 7.09 9 7.09 1.51 0 2.9-.38 4.13-1.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M2.46 12C3.73 7.94 7.52 5 12 5c4.48 0 8.27 2.94 9.54 7-1.27 4.06-5.06 7-9.54 7-4.48 0-8.27-2.94-9.54-7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        )}
      </button>
    </div>
  );
}

function formatNotificationTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function AdminNotificationBell({ authToken }: { authToken: string }) {
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
        const response = await fetch("/api/lambda-proxy/api/notifications/me", {
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
      const response = await fetch(`/api/lambda-proxy/api/notifications/${id}/read`, {
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
      const response = await fetch(`/api/lambda-proxy/api/notifications/${id}`, {
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
      const response = await fetch("/api/lambda-proxy/api/notifications", {
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
        await fetch(`/api/lambda-proxy/api/notifications/${item.id}/read`, {
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
        aria-label="Mở thông báo admin"
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
              <p className="text-sm font-semibold">Thông báo quản trị</p>
              <p className="text-xs text-slate-500">{pendingCount} chưa đọc</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy || pendingCount === 0}
                onClick={() => void markAllAsRead()}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
              >
                Đọc hết
              </button>
              <button
                type="button"
                disabled={busy || notifications.length === 0}
                onClick={() => void clearAll()}
                className="rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
              >
                Xóa hết
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {notifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Chưa có thông báo nào cho admin.
              </div>
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
                      <p className={`text-sm font-semibold ${item.isRead ? "text-slate-500" : "text-slate-900"}`}>{item.title}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {isCritical ? "Hết hàng" : "Sắp hết hàng"} {item.createdAt ? `· ${formatNotificationTime(item.createdAt)}` : ""}
                      </p>
                    </div>
                    {!item.isRead ? <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!item.isRead ? (
                      <button
                        type="button"
                        onClick={() => void markAsRead(item.id)}
                        className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Đánh dấu đã đọc
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void removeNotification(item.id, Boolean(item.isRead))}
                      className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100"
                    >
                      Xóa
                    </button>
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("Dùng tài khoản Cognito để truy cập API admin trên AWS.");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");

  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmCode, setConfirmCode] = useState("");

  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");

  useEffect(() => {
    const nextSession = readAuthSession();
    if (!nextSession) {
      clearAuthSession();
    }

    setSession(nextSession);
    setReady(true);
  }, []);

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
    if (searchParams.get("auth") === "insufficient-role") {
      setMessage("Tài khoản hiện tại đã đăng nhập nhưng không thuộc nhóm admin, nên không thể vào màn quản trị.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!ready || !session) return;

    const postLoginRedirect = consumePostLoginRedirect();
    if (postLoginRedirect && session.role !== "admin") {
      router.replace(postLoginRedirect);
      return;
    }

    if (session.role !== "admin") {
      setMessage(`Tài khoản ${session.email} đang có quyền ${session.role}. Muốn vào admin, hãy đăng nhập bằng user thuộc group admin.`);
    }
  }, [ready, router, session]);

  useEffect(() => {
    if (!ready || !session || session.role === "admin") {
      return;
    }

    router.replace("/store");
  }, [ready, router, session]);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [resendCountdown]);

  function handleLogout() {
    clearAuthSession();
    setSession(null);
    setMessage("Đã đăng xuất.");
    setAuthMode("login");
  }

  function handleHostedLogout() {
    signOutLocally();
    handleLogout();
  }

  function renderMessageTone() {
    const lowered = message.toLowerCase();

    if (
      lowered.includes("thất bại") ||
      lowered.includes("không") ||
      lowered.includes("sai") ||
      lowered.includes("hết hạn") ||
      lowered.includes("khớp") ||
      lowered.includes("đã được đăng ký") ||
      lowered.includes("không thuộc nhóm admin")
    ) {
      return "border-rose-200 bg-rose-50 text-rose-700";
    }

    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (!loginEmail.trim() || !loginPassword.trim()) {
        throw new Error("Hãy nhập đầy đủ email và mật khẩu.");
      }

      const nextSession = await signInWithCognito({
        email: loginEmail,
        password: loginPassword
      });

      setSession(nextSession);
      if (nextSession.role !== "admin") {
        const postLoginRedirect = consumePostLoginRedirect();
        if (postLoginRedirect) {
          router.replace(postLoginRedirect);
          return;
        }
        router.replace("/store");
        return;
      }
      setMessage(
        nextSession.role === "admin"
          ? "Đăng nhập admin thành công."
          : `Đăng nhập thành công nhưng tài khoản hiện tại có quyền ${nextSession.role}, chưa đủ để vào admin.`
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "Đăng nhập thất bại";
      setMessage(text);

      if (/xác nhận|confirm/i.test(text)) {
        setConfirmEmail(loginEmail);
        setAuthMode("confirm");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (registerPassword.length < 8) {
        throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
      }

      if (registerPassword !== registerConfirmPassword) {
        throw new Error("Mật khẩu xác nhận không khớp.");
      }

      await signUpWithCognito({
        email: registerEmail,
        password: registerPassword,
        name: registerName
      });

      setConfirmEmail(registerEmail);
      setLoginEmail(registerEmail);
      setLoginPassword(registerPassword);
      setResendCountdown(60);
      setAuthMode("confirm");
      setMessage("Tạo tài khoản thành công. Hãy kiểm tra email để lấy mã xác nhận.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Đăng ký thất bại");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (!confirmCode.trim()) {
        throw new Error("Hãy nhập mã xác nhận.");
      }

      await confirmSignUpWithCognito({
        email: confirmEmail,
        code: confirmCode
      });

      setResendCountdown(0);
      setAuthMode("login");
      setMessage("Xác nhận tài khoản thành công. Bạn có thể đăng nhập ngay.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Xác nhận tài khoản thất bại");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (!forgotEmail.trim()) {
        throw new Error("Hãy nhập email để nhận mã đặt lại mật khẩu.");
      }

      await forgotPassword(forgotEmail);
      setAuthMode("reset");
      setMessage("Đã gửi mã đặt lại mật khẩu tới email của bạn.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể bắt đầu đặt lại mật khẩu");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (resetPassword.length < 8) {
        throw new Error("Mật khẩu mới cần ít nhất 8 ký tự.");
      }

      if (resetPassword !== resetConfirmPassword) {
        throw new Error("Mật khẩu xác nhận không khớp.");
      }

      if (resetPassword === loginPassword && forgotEmail.trim().toLowerCase() === loginEmail.trim().toLowerCase()) {
        throw new Error("Mật khẩu mới không nên giống mật khẩu cũ vừa sử dụng.");
      }

      await confirmForgotPassword({
        email: forgotEmail,
        code: resetCode,
        newPassword: resetPassword
      });

      setAuthMode("login");
      setLoginEmail(forgotEmail);
      setLoginPassword("");
      setMessage("Đã cập nhật mật khẩu. Hãy đăng nhập bằng mật khẩu mới.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Đặt lại mật khẩu thất bại");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    if (resendCountdown > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await resendConfirmationCode(confirmEmail);
      setResendCountdown(60);
      setMessage("Đã gửi lại mã xác nhận mới.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể gửi lại mã xác nhận");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!ready) {
    return null;
  }

  const singleActionMode = authMode === "register" || authMode === "confirm" || authMode === "forgot" || authMode === "reset";
  const showAdminLoginScreen = !session || session.role !== "admin";

  return (
    <div
      className={`grid gap-4 ${
        showAdminLoginScreen
          ? "min-h-[calc(100vh-11rem)] place-items-center rounded-[2rem] border border-cyan-100 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(180deg,_#f8fbff_0%,_#eef6ff_45%,_#fdfefe_100%)] p-4 shadow-[0_30px_100px_rgba(15,23,42,0.08)]"
          : ""
      }`}
    >
      {!session || session.role !== "admin" ? (
        <section className="mx-auto w-full max-w-md rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_30px_100px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="mb-5 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {authMode === "login" && "Đăng nhập"}
              {authMode === "register" && "Tạo tài khoản"}
              {authMode === "confirm" && "Xác nhận email"}
              {authMode === "forgot" && "Quên mật khẩu"}
              {authMode === "reset" && "Đặt lại mật khẩu"}
            </h2>
            <p className={`mt-3 rounded-2xl border px-4 py-3 text-left text-sm ${renderMessageTone()}`}>{message}</p>
            {session && session.role !== "admin" ? (
              <div className="mt-3 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Về trang chủ
                </button>
                <button
                  type="button"
                  onClick={handleHostedLogout}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  Đăng xuất để đổi tài khoản
                </button>
              </div>
            ) : null}
          </div>

          {!session ? (
            <>
              {authMode === "login" ? (
                <form className="grid gap-4" onSubmit={handleLogin}>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Email</span>
                    <input className={inputClassName} type="email" placeholder="admin@example.com" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Mật khẩu</span>
                    <PasswordField
                      value={loginPassword}
                      onChange={setLoginPassword}
                      placeholder="Nhập mật khẩu của bạn"
                      autoComplete="current-password"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
                  </button>
                  <button
                    type="button"
                    onClick={beginGoogleSignIn}
                    className="inline-flex h-11 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.8-6-6.2s2.7-6.2 6-6.2c1.9 0 3.2.8 3.9 1.5l2.7-2.6C17 2.9 14.7 2 12 2 6.9 2 2.8 6.3 2.8 11.8S6.9 21.5 12 21.5c6.9 0 9.2-4.9 9.2-7.5 0-.5 0-.9-.1-1.3H12Z" />
                      <path fill="#4285F4" d="M3.8 7.3l3.2 2.4C7.8 7.3 9.7 5.6 12 5.6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C17 2.9 14.7 2 12 2 8 2 4.6 4.3 3 7.7l.8-.4Z" />
                      <path fill="#FBBC05" d="M12 21.5c2.6 0 4.8-.9 6.4-2.5l-3-2.5c-.8.6-1.9 1-3.4 1-3.9 0-5.2-2.6-5.5-3.9l-3.2 2.5C4.6 19.2 8 21.5 12 21.5Z" />
                      <path fill="#34A853" d="M6.5 13.6c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8L3.3 7.5C2.8 8.7 2.5 10.2 2.5 11.8s.3 3.1.8 4.3l3.2-2.5Z" />
                    </svg>
                    <span>Đăng nhập với Google</span>
                  </button>
                </form>
              ) : null}

              {authMode === "register" ? (
                <form className="grid gap-4" onSubmit={handleRegister}>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Họ và tên</span>
                    <input className={inputClassName} placeholder="Ví dụ: Nguyễn Văn A" value={registerName} onChange={(event) => setRegisterName(event.target.value)} />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Email</span>
                    <input className={inputClassName} type="email" placeholder="you@example.com" value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} required />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Mật khẩu</span>
                    <PasswordField
                      value={registerPassword}
                      onChange={setRegisterPassword}
                      placeholder="Ít nhất 8 ký tự, có chữ hoa, chữ thường và số"
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Xác nhận mật khẩu</span>
                    <PasswordField
                      value={registerConfirmPassword}
                      onChange={setRegisterConfirmPassword}
                      placeholder="Nhập lại mật khẩu để xác nhận"
                      autoComplete="new-password"
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    Quy tắc mật khẩu: ít nhất 8 ký tự, có chữ hoa, chữ thường và số.
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Đang tạo tài khoản..." : "Tạo tài khoản"}
                  </button>
                </form>
              ) : null}

              {authMode === "confirm" ? (
                <form className="grid gap-4" onSubmit={handleConfirm}>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Email</span>
                    <input className={inputClassName} type="email" placeholder="Email vừa đăng ký" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} required />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Mã xác nhận</span>
                    <input className={inputClassName} placeholder="Nhập mã gồm 6 chữ số từ email" value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} required />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Đang xác nhận..." : "Xác nhận tài khoản"}
                  </button>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isSubmitting || resendCountdown > 0}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendCountdown > 0 ? `Gửi lại mã sau ${resendCountdown}s` : "Gửi lại mã"}
                  </button>
                </form>
              ) : null}

              {authMode === "forgot" ? (
                <form className="grid gap-4" onSubmit={handleForgotPassword}>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Email</span>
                    <input className={inputClassName} type="email" placeholder="Nhập email tài khoản của bạn" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} required />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Đang gửi mã..." : "Gửi mã đặt lại"}
                  </button>
                </form>
              ) : null}

              {authMode === "reset" ? (
                <form className="grid gap-4" onSubmit={handleResetPassword}>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Email</span>
                    <input className={inputClassName} type="email" placeholder="Email cần đặt lại mật khẩu" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} required />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Mã đặt lại</span>
                    <input className={inputClassName} placeholder="Nhập mã đặt lại từ email" value={resetCode} onChange={(event) => setResetCode(event.target.value)} required />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Mật khẩu mới</span>
                    <PasswordField
                      value={resetPassword}
                      onChange={setResetPassword}
                      placeholder="Tạo mật khẩu mới mạnh hơn mật khẩu cũ"
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    <span>Xác nhận mật khẩu mới</span>
                    <PasswordField
                      value={resetConfirmPassword}
                      onChange={setResetConfirmPassword}
                      placeholder="Nhập lại mật khẩu mới"
                      autoComplete="new-password"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Đang cập nhật mật khẩu..." : "Cập nhật mật khẩu"}
                  </button>
                </form>
              ) : null}

              <div className={`mt-5 grid gap-3 ${singleActionMode ? "grid-cols-1" : "grid-cols-2"}`}>
                {authMode !== "register" && authMode !== "forgot" && authMode !== "reset" && authMode !== "confirm" ? (
                  <button
                    type="button"
                    onClick={() => setAuthMode("register")}
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100"
                  >
                    Tạo tài khoản
                  </button>
                ) : null}
                {authMode !== "forgot" && authMode !== "reset" && authMode !== "register" && authMode !== "confirm" ? (
                  <button
                    type="button"
                    onClick={() => setAuthMode("forgot")}
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Quên mật khẩu
                  </button>
                ) : null}
                {authMode !== "login" ? (
                  <button
                    type="button"
                    onClick={() => setAuthMode("login")}
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Quay lại đăng nhập
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {session && session.role === "admin" ? (
        <ShoppingManager
          authToken={session.idToken}
          canManageProducts={session.role === "admin"}
          headerActions={(
            <div className="relative z-50 flex items-center gap-3">
              <AdminNotificationBell authToken={session.idToken} />
              <div className="hidden rounded-2xl bg-cyan-50 px-4 py-3 text-right ring-1 ring-cyan-200 md:block">
                <p className="text-sm font-semibold text-slate-900">{session.name}</p>
                <p className="text-xs text-slate-500">{session.email}</p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                  {session.role === "admin" ? "Quản trị viên" : session.role === "customer" ? "Khách hàng" : "Người xem"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleHostedLogout}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Đăng xuất
              </button>
            </div>
          )}
        />
      ) : null}
    </div>
  );
}
