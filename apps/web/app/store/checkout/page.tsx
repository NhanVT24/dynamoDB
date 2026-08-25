"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authSessionChangedEvent, readAuthSession, type AuthSession } from "../../lib/cognito-auth";
import { useStorefront } from "../store-client";
import { fetchStorefrontProducts } from "../store-api";
import { formatCurrency } from "../store-utils";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";
const resumeCheckoutAfterLoginStorageKey = "web-storefront-resume-checkout-after-login";
const checkoutGatePollIntervalMs = 1000;
// SQS/EventBridge Pipes can take up to a long-poll cycle before invoking the
// worker, so a 15-second UI timeout can expire while a valid request is queued.
const checkoutGateMaxPollAttempts = 40;
const failedRedirectDelaySeconds = 15;

type PrepareCheckoutResponse = {
  requestId?: string;
  status?: "pending" | "allowed" | "blocked";
  message?: string;
};

type CheckoutGateStatusResponse = {
  requestId?: string;
  status?: "pending" | "allowed" | "blocked";
  message?: string;
  failureCode?: string;
  paymentUrl?: string;
  lockedUntil?: string;
};

type CheckoutPaymentSessionResponse = {
  requestId?: string;
  paymentUrl?: string;
  lockedUntil?: string;
  message?: string;
};

type CancelCheckoutResponse = {
  success?: boolean;
  released?: boolean;
  requestId?: string;
  message?: string;
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, shipping, total, theme, openAuthModal, removeItem } = useStorefront();
  const isDark = theme === "dark";
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirectingToPayment, setIsRedirectingToPayment] = useState(false);
  const [error, setError] = useState("");
  const [gateRequestId, setGateRequestId] = useState("");
  const [gateStatus, setGateStatus] = useState<"idle" | "pending" | "allowed" | "blocked">("idle");
  const [gateMessage, setGateMessage] = useState("");
  const [redirectCountdown, setRedirectCountdown] = useState(0);
  const [shouldRedirectHome, setShouldRedirectHome] = useState(false);
  const hasResumedCheckoutAfterLoginRef = useRef(false);
  const isPollingGateRef = useRef(false);
  const isCreatingPaymentSessionRef = useRef(false);
  const lastLoggedGateStatusRef = useRef("");

  const isFailureOverlayVisible = !isSubmitting && gateStatus === "blocked" && Boolean(error) && redirectCountdown > 0;

  function resetFailureRedirect() {
    setRedirectCountdown(0);
    setShouldRedirectHome(false);
  }

  function startFailureRedirect() {
    setIsSubmitting(false);
    setIsRedirectingToPayment(false);
    setRedirectCountdown(failedRedirectDelaySeconds);
  }

  function goToStoreHome() {
    resetFailureRedirect();
    router.push("/store");
  }

  useEffect(() => {
    setHasHydrated(true);

    const syncSession = () => {
      setSession(readAuthSession());
    };

    syncSession();
    window.addEventListener(authSessionChangedEvent, syncSession);
    return () => {
      window.removeEventListener(authSessionChangedEvent, syncSession);
    };
  }, []);

  useEffect(() => {
    if (!session?.idToken) {
      return;
    }

    let cancelled = false;

    async function releaseAbandonedCheckout() {
      const rawPendingCheckout = window.localStorage.getItem(pendingCheckoutStorageKey);
      if (!rawPendingCheckout) {
        return;
      }

      let pendingCheckout: { requestId?: string } | null = null;
      try {
        pendingCheckout = JSON.parse(rawPendingCheckout) as { requestId?: string } | null;
      } catch {
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        return;
      }

      const requestId = String(pendingCheckout?.requestId ?? "").trim();
      if (!requestId) {
        window.localStorage.removeItem(pendingCheckoutStorageKey);
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.idToken}`
          },
          body: JSON.stringify({ requestId })
        });
        const payload = (await response.json().catch(() => null)) as CancelCheckoutResponse | null;
        if (!cancelled && response.ok && payload?.success) {
          window.localStorage.removeItem(pendingCheckoutStorageKey);
        }
      } catch {
      }
    }

    void releaseAbandonedCheckout();
    return () => {
      cancelled = true;
    };
  }, [session?.idToken]);

  useEffect(() => {
    if (gateStatus !== "blocked" || !error) {
      resetFailureRedirect();
      return;
    }

    setRedirectCountdown(failedRedirectDelaySeconds);

    const intervalId = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          setShouldRedirectHome(true);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [error, gateStatus, router]);

  useEffect(() => {
    if (!shouldRedirectHome) {
      return;
    }

    router.push("/store");
  }, [router, shouldRedirectHome]);

  useEffect(() => {
    if (!hasHydrated || !session?.idToken || hasResumedCheckoutAfterLoginRef.current) {
      return;
    }

    if (window.sessionStorage.getItem(resumeCheckoutAfterLoginStorageKey) !== "1") {
      return;
    }

    hasResumedCheckoutAfterLoginRef.current = true;
    window.sessionStorage.removeItem(resumeCheckoutAfterLoginStorageKey);
    void handleCheckout();
  }, [hasHydrated, session?.idToken]);

  async function createPaymentSessionAndRedirect(requestId: string) {
    if (!session?.idToken) {
      throw new Error("Your payment is expired. Please sign in again to continue checkout.");
    }

    if (isCreatingPaymentSessionRef.current) {
      return;
    }
    isCreatingPaymentSessionRef.current = true;
    console.info("[checkout] payment_session_started", { requestId });

    setIsRedirectingToPayment(true);
    setGateMessage("Completing verification and redirecting to VNPay...");

    const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/payment-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.idToken}`
      },
      body: JSON.stringify({ requestId })
    });
    const payload = (await response.json().catch(() => null)) as CheckoutPaymentSessionResponse | null;
    console.info("[checkout] payment_session_response", {
      requestId,
      statusCode: response.status,
      hasPaymentUrl: Boolean(payload?.paymentUrl),
      message: payload?.message ?? ""
    });
    if (!response.ok || !payload?.paymentUrl) {
      throw new Error(payload?.message || "Cannot create VNPay payment session at this time.");
    }

    window.localStorage.setItem(
      pendingCheckoutStorageKey,
      JSON.stringify({
        email: session.email ?? "",
        requestId,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        createdAt: new Date().toISOString()
      })
    );

    window.location.assign(payload.paymentUrl);
  }

  useEffect(() => {
    if (!gateRequestId || gateStatus !== "pending" || !session?.idToken) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function pollGateStatus() {
      if (isPollingGateRef.current || cancelled) {
        return;
      }

      isPollingGateRef.current = true;
      attempts += 1;
      try {
        const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${gateRequestId}`, {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as CheckoutGateStatusResponse | null;
        if (!response.ok || !payload?.status || cancelled) {
          console.warn("[checkout] gate_status_unavailable", {
            requestId: gateRequestId,
            attempt: attempts,
            statusCode: response.status
          });
          return;
        }

        console.info("[checkout] gate_status_response", {
          requestId: gateRequestId,
          attempt: attempts,
          status: payload.status,
          message: payload.message || ""
        });

        setGateMessage(payload.message || "");
        if (payload.status !== lastLoggedGateStatusRef.current || attempts % 5 === 0) {
          console.info("[checkout] gate_status", {
            requestId: gateRequestId,
            attempt: attempts,
            status: payload.status,
            message: payload.message || ""
          });
          lastLoggedGateStatusRef.current = payload.status;
        }

        if (payload.status === "allowed") {
          setGateStatus("allowed");
          await createPaymentSessionAndRedirect(gateRequestId);
          return;
        }

        if (payload.status === "blocked") {
          setGateStatus("blocked");
          setError(payload.message || "We could not reserve all items in your cart for payment. Please review your cart and try again.");
          startFailureRedirect();
          return;
        }

        if (attempts >= checkoutGateMaxPollAttempts) {
          console.error("[checkout] gate_timeout", { requestId: gateRequestId, attempts });
          setGateStatus("blocked");
          setError(`The checkout queue is taking too long for request ${gateRequestId}. Please check the checkout-gate worker on AWS and try again.`);
          startFailureRedirect();
        }
      } catch (pollError) {
        if (!cancelled) {
          console.error("[checkout] gate_poll_failed", { requestId: gateRequestId, pollError });
          setError(pollError instanceof Error ? pollError.message : "We could not check the checkout queue right now.");
          setGateStatus("blocked");
          startFailureRedirect();
        }
      } finally {
        isPollingGateRef.current = false;
      }
    }

    void pollGateStatus();
    const intervalId = window.setInterval(() => {
      void pollGateStatus();
    }, checkoutGatePollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [gateRequestId, gateStatus, items, session]);

  async function handleCheckout() {
    if (items.length === 0) {
      setError("Your cart is empty. Please add at least one product before checkout.");
      return;
    }

    if (!apiBaseUrl) {
      setError("NEXT_PUBLIC_API_URL is missing, so checkout cannot start.");
      return;
    }

    try {
      if (!session?.idToken) {
        window.sessionStorage.setItem(resumeCheckoutAfterLoginStorageKey, "1");
        openAuthModal("/store/checkout");
        return;
      }

      setIsSubmitting(true);
      setIsRedirectingToPayment(false);
      isCreatingPaymentSessionRef.current = false;
      lastLoggedGateStatusRef.current = "";
      setError("");
      resetFailureRedirect();
      setGateRequestId("");
      setGateStatus("idle");
      setGateMessage("Checking current availability in your cart...");

      // Cart entries are persisted locally, so revalidate them before a user
      // can start checkout after another customer reserves the last units.
      const productCatalog = await fetchStorefrontProducts({ limit: "240" });
      const productsById = new Map(productCatalog.items.map((product) => [product.id, product]));
      const unavailableItems = items.filter((item) => {
        const product = productsById.get(item.productId);
        return !product || product.isLocked || product.status === "out_of_stock" || product.stock < item.quantity;
      });
      if (unavailableItems.length > 0) {
        unavailableItems.forEach((item) => removeItem(item.variantId));
        setIsSubmitting(false);
        setError("Some items in your cart were reserved or sold out and have been removed. Please review your cart before checking out.");
        return;
      }

      setGateMessage("Preparing your checkout request and sending it to the product gate queue.");
      const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.idToken}`
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          })),
          locale: "vn",
          processingMode: "interactive"
        })
      });

      const payload = (await response.json().catch(() => null)) as PrepareCheckoutResponse | null;
      console.info("[checkout] prepare_response", {
        statusCode: response.status,
        requestId: payload?.requestId ?? "",
        status: payload?.status ?? "",
        message: payload?.message ?? ""
      });

      if (!response.ok || !payload?.requestId) {
        throw new Error(payload?.message || "We could not send this checkout request to the queue.");
      }

      setGateRequestId(payload.requestId);
      setGateStatus("pending");
      setGateMessage(payload.message || "Your request is waiting in the queue for inventory verification.");
    } catch (checkoutError) {
      setGateStatus("blocked");
      setError(checkoutError instanceof Error ? checkoutError.message : "We could not start checkout verification.");
      startFailureRedirect();
    }
  }

  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      {isSubmitting || isFailureOverlayVisible ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[3px]">
          {isFailureOverlayVisible ? (
            <div className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-rose-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(255,244,246,0.98)_100%)] shadow-[0_40px_120px_-34px_rgba(190,24,93,0.35)]">
              <div className="relative overflow-hidden px-7 pb-6 pt-7 text-center">
                <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(251,113,133,0.28),transparent_70%)]" />
                <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-rose-200 bg-white shadow-[0_18px_50px_-24px_rgba(225,29,72,0.45)]">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-3xl font-black text-white shadow-[0_14px_30px_-18px_rgba(225,29,72,0.55)]">
                    ×
                  </div>
                </div>
                <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-rose-500">
                  Checkout Interrupted
                </p>
                <h2 className="relative mt-3 text-[1.9rem] font-semibold tracking-tight text-slate-950">
                  Sorry, this payment could not continue
                </h2>
                <p className="relative mx-auto mt-3 max-w-md text-sm leading-7 text-slate-600">
                  Another checkout may have reserved the remaining quantity, or your order is still finishing synchronization. We are sending you back to the store safely so you can try again.
                </p>

                <div className="relative mt-6 rounded-[1.5rem] border border-rose-200/80 bg-white/90 p-5 text-left shadow-[0_20px_40px_-30px_rgba(15,23,42,0.35)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-500">What happened</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    {error || "The checkout gate could not keep enough stock reserved for this order."}
                  </p>
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Returning to store in {redirectCountdown}s
                  </div>
                </div>

                <div className="relative mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={goToStoreHome}
                    className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Back To Store Home
                  </button>
                  <button
                    type="button"
                    onClick={resetFailureRedirect}
                    className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-6 py-3 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                  >
                    Keep This Message Open
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-sm rounded-[2rem] border border-white/45 bg-white/92 p-7 text-center shadow-[0_30px_90px_-30px_rgba(15,23,42,0.45)]">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 shadow-inner shadow-slate-200">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white shadow-[0_8px_30px_-18px_rgba(15,23,42,0.45)]">
                  <span className="inline-flex h-10 w-10 animate-spin rounded-full border-[3px] border-slate-300 border-t-sky-500 border-r-cyan-400" />
                </div>
              </div>
              <h2 className="mt-6 text-xl font-semibold tracking-tight text-slate-950">Please wait a moment</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Sorry, we are confirming product availability and reserving your checkout slot before redirecting you to payment.
              </p>
              <p className="mt-3 text-sm font-medium text-sky-700">
                {gateMessage || (isRedirectingToPayment
                  ? "Completing verification and opening VNPay..."
                  : "Checking inventory in real-time...")}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section
          className={`rounded-[2rem] border p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.25)] ${
            isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-950"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Checkout</p>
          <h1 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Checkout with VNPay Sandbox</h1>
          <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            Your request is sent to the product gate queue first. You are redirected to VNPay only after the inventory hold is confirmed.
          </p>
          {hasHydrated && !session ? (
            <div className={`mt-6 rounded-[1.5rem] border px-4 py-4 text-sm ${isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              You need to sign in before checkout.
            </div>
          ) : null}

          <div className="mt-8 space-y-4">
            {items.map((item) => (
              <article
                key={item.variantId}
                className={`flex gap-4 rounded-[1.5rem] border p-4 ${
                  isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                }`}
              >
                <img src={item.image} alt={item.productName} className="h-20 w-20 rounded-3xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className={`line-clamp-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.productName}</h2>
                      <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{item.variantName}</p>
                    </div>
                    <strong className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(item.price * item.quantity)}</strong>
                  </div>
                  <p className={`mt-3 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Quantity: {item.quantity}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.5)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-300">Order summary</p>
          <div className="mt-6 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Shipping</span>
              <span>{shipping === 0 ? "Free" : formatCurrency(shipping)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/15 pt-4 text-lg font-semibold">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] bg-white/8 p-4 text-sm leading-7 text-slate-200">
            <p>The checkout gate processes conflicting product requests in arrival order.</p>
            <p className="mt-2">If another request is already holding the product, you will see the block message here immediately.</p>
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
            {!hasHydrated
              ? "Loading checkout..."
              : session
                ? (isSubmitting ? (isRedirectingToPayment ? "Opening VNPay..." : "Checking inventory queue...") : "Pay now")
                : "Sign in to pay"}
          </button>
        </aside>
      </div>
    </main>
  );
}
