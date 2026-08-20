"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  consumePostLoginRedirect,
  exchangeAuthorizationCodeForSession,
  resolvePostLoginRoute
} from "../../../src/features/auth/lib/cognito-auth";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Completing Google sign-in...");

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (error) {
      setMessage(errorDescription || "Google sign-in through Cognito was rejected.");
      return;
    }

    if (!code) {
      setMessage("No authorization code was received from Cognito.");
      return;
    }

    exchangeAuthorizationCodeForSession(code)
      .then((session) => {
        router.replace(resolvePostLoginRoute(session, consumePostLoginRedirect()));
      })
      .catch((reason: unknown) => {
        setMessage(reason instanceof Error ? reason.message : "We could not complete Google sign-in.");
      });
  }, [router, searchParams]);

  return (
    <section className="w-full rounded-[28px] border border-white/70 bg-white p-6 text-center shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Google Authentication</h1>
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Google Authentication</h1>
            <p className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
              Preparing Google authentication...
            </p>
          </section>
        )}
      >
        <AuthCallbackContent />
      </Suspense>
    </main>
  );
}
