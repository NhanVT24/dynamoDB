"use client";

import { FormEvent, useEffect, useState } from "react";
import ShoppingManager from "./components/ShoppingManager";

type AuthMode = "login" | "register";

type MockUser = {
  name: string;
  email: string;
  role: string;
};

type MockAccount = MockUser & {
  password: string;
};

const storageKey = "mock-auth-session";

const defaultAccounts: MockAccount[] = [
  {
    email: "admin@demo.local",
    password: "123456",
    name: "Demo Admin",
    role: "Administrator"
  }
];

const inputClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100";

export default function Home() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<MockUser | null>(null);
  const [accounts, setAccounts] = useState<MockAccount[]>(defaultAccounts);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("Bấm đăng nhập hoặc đăng ký để mở popup.");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [loginEmail, setLoginEmail] = useState(defaultAccounts[0].email);
  const [loginPassword, setLoginPassword] = useState(defaultAccounts[0].password);

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  useEffect(() => {
    const rawSession = window.localStorage.getItem(storageKey);

    if (rawSession) {
      try {
        setUser(JSON.parse(rawSession) as MockUser);
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    setReady(true);
  }, []);

  function openAuthModal(mode: AuthMode) {
    setAuthMode(mode);
    setIsAuthOpen(true);
    setMessage(mode === "login" ? "Popup đăng nhập đang mở." : "Popup đăng ký đang mở.");
  }

  function closeAuthModal() {
    setIsAuthOpen(false);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    await new Promise((resolve) => window.setTimeout(resolve, 250));

    const account = accounts.find(
      (item) => item.email.toLowerCase() === loginEmail.trim().toLowerCase() && item.password === loginPassword
    );

    if (!account) {
      setIsSubmitting(false);
      setMessage("Sai tài khoản hoặc mật khẩu. Demo mặc định: admin@demo.local / 123456");
      return;
    }

    const nextUser = {
      name: account.name,
      email: account.email,
      role: account.role
    };

    setUser(nextUser);
    window.localStorage.setItem(storageKey, JSON.stringify(nextUser));
    setIsSubmitting(false);
    setIsAuthOpen(false);
    setMessage("Đăng nhập mock thành công.");
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    await new Promise((resolve) => window.setTimeout(resolve, 250));

    const normalizedEmail = registerEmail.trim().toLowerCase();

    if (accounts.some((item) => item.email.toLowerCase() === normalizedEmail)) {
      setIsSubmitting(false);
      setMessage("Email này đã tồn tại trong mock data.");
      return;
    }

    const newAccount: MockAccount = {
      name: registerName.trim(),
      email: normalizedEmail,
      password: registerPassword,
      role: "Member"
    };

    setAccounts((current) => [...current, newAccount]);
    setLoginEmail(newAccount.email);
    setLoginPassword(newAccount.password);
    setRegisterName("");
    setRegisterEmail("");
    setRegisterPassword("");
    setAuthMode("login");
    setIsSubmitting(false);
    setMessage("Đăng ký mock thành công. Bạn có thể đăng nhập ngay.");
  }

  function handleLogout() {
    setUser(null);
    window.localStorage.removeItem(storageKey);
    setMessage("Đã đăng xuất khỏi phiên mock.");
  }

  if (!ready) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <section className="flex items-center justify-between gap-3 rounded-3xl border border-white/70 bg-white/82 px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-500">{message}</p>
          {!user ? (
            <p className="mt-1 truncate text-sm text-slate-500">
              Demo mặc định: <strong className="text-slate-900">admin@demo.local</strong> /{" "}
              <strong className="text-slate-900">123456</strong>
            </p>
          ) : (
            <p className="mt-1 truncate text-sm text-slate-500">
              Đang đăng nhập với <strong className="text-slate-900">{user.email}</strong>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {user ? (
            <>
              <div className="hidden rounded-2xl bg-cyan-50 px-4 py-3 text-right ring-1 ring-cyan-200 md:block">
                <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openAuthModal("register")}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Đăng ký
              </button>
              <button
                type="button"
                onClick={() => openAuthModal("login")}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Đăng nhập
              </button>
            </>
          )}
        </div>
      </section>

      <ShoppingManager />

      {isAuthOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onClick={closeAuthModal}
        >
          <div
            className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.2)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">
                  {authMode === "login" ? "Login" : "Register"}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {authMode === "login" ? "Đăng nhập" : "Tạo tài khoản mock"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeAuthModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
              >
                ×
              </button>
            </div>

            {authMode === "login" ? (
              <form className="grid gap-4" onSubmit={handleLogin}>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>Email</span>
                  <input
                    className={inputClassName}
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>Mật khẩu</span>
                  <input
                    className={inputClassName}
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Đang xử lý..." : "Đăng nhập"}
                </button>
              </form>
            ) : (
              <form className="grid gap-4" onSubmit={handleRegister}>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>Họ tên</span>
                  <input
                    className={inputClassName}
                    value={registerName}
                    onChange={(event) => setRegisterName(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>Email</span>
                  <input
                    className={inputClassName}
                    type="email"
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>Mật khẩu</span>
                  <input
                    className={inputClassName}
                    type="password"
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Đang xử lý..." : "Đăng ký"}
                </button>
              </form>
            )}

            <div className="mt-5 text-sm text-slate-500">
              {authMode === "login" ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
              <button
                type="button"
                onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                className="font-semibold text-cyan-700"
              >
                {authMode === "login" ? "Đăng ký tại đây" : "Đăng nhập tại đây"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
