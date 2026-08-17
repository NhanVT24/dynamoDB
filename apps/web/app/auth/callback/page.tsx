"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeAuthorizationCodeForSession } from "../../../src/features/auth/lib/cognito-auth";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Đang hoàn tất đăng nhập Google...");

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (error) {
      setMessage(errorDescription || "Đăng nhập Google qua Cognito bị từ chối.");
      return;
    }

    if (!code) {
      setMessage("Không nhận được mã xác thực từ Cognito.");
      return;
    }

    exchangeAuthorizationCodeForSession(code)
      .then((session) => {
        router.replace(session.role === "admin" ? "/admin" : "/store");
      })
      .catch((reason: unknown) => {
        setMessage(reason instanceof Error ? reason.message : "Không thể hoàn tất đăng nhập Google.");
      });
  }, [router, searchParams]);

  return (
    <section className="w-full rounded-[28px] border border-white/70 bg-white p-6 text-center shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Xác thực Google</h1>
      <p className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
        {message}
      </p>
    </section>
  );
}

export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-6 py-16">
      <Suspense
        fallback={(
          <section className="w-full rounded-[28px] border border-white/70 bg-white p-6 text-center shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Xác thực Google</h1>
            <p className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
              Đang chuẩn bị xác thực Google...
            </p>
          </section>
        )}
      >
        <AuthCallbackContent />
      </Suspense>
    </main>
  );
}
