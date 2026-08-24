(async () => {
  const apiBaseUrl = (window.__STORE_API_BASE_URL__
    || `${location.origin}/api/lambda-proxy`).replace(/\/+$/, "");
  const authStorageCandidates = [
    "cognito-auth-session",
    "web-auth-session",
    "auth-session"
  ];
  const defaultProductId = "506284f1-bdac-4241-83ce-99454e09a87e";
  const defaultPollDelayMs = 400;
  const defaultMaxAttempts = 25;

  const authRaw = authStorageCandidates
    .map((key) => window.localStorage.getItem(key))
    .find(Boolean);

  if (!authRaw) {
    throw new Error("Khong tim thay session dang nhap trong localStorage.");
  }

  const auth = JSON.parse(authRaw);
  const idToken = String(auth?.idToken ?? "").trim();
  if (!idToken) {
    throw new Error("Session hien tai khong co idToken.");
  }

  async function getProduct(productId) {
    const response = await fetch(`${apiBaseUrl}/api/storefront/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${idToken}`
      },
      cache: "no-store"
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.id) {
      throw new Error(payload?.message || `Khong the lay thong tin san pham ${productId}.`);
    }

    return payload;
  }

  async function startCheckout(productId, quantity) {
    const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        items: [{ productId, quantity }],
        locale: "vn",
        processingMode: "trigger"
      })
    });

    const payload = await response.json().catch(() => null);
    console.log("[preempt-manual-checkout] prepare =", response.status, payload);

    if (!response.ok || !payload?.requestId) {
      throw new Error(payload?.message || "Khong tao duoc checkout gate request.");
    }

    return String(payload.requestId);
  }

  async function pollRequest(requestId, pollDelayMs, maxAttempts) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));

      const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${requestId}`, {
        headers: {
          Authorization: `Bearer ${idToken}`
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);

      console.log(`[preempt-manual-checkout] poll #${attempt} =`, response.status, payload);

      if (payload?.status === "allowed" || payload?.status === "blocked") {
        return payload;
      }
    }

    throw new Error(`Polling qua ${maxAttempts} lan nhung request ${requestId} van chua ra allowed/blocked.`);
  }

  async function createPaymentSession(requestId) {
    const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/payment-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ requestId })
    });

    const payload = await response.json().catch(() => null);
    console.log("[preempt-manual-checkout] payment-session =", response.status, payload);

    if (!response.ok) {
      throw new Error(payload?.message || "Khong tao duoc payment session.");
    }

    return payload;
  }

  const productId = String(window.__PREEMPT_PRODUCT_ID__ ?? defaultProductId).trim().replace(/^PRODUCT#/i, "");
  const requestedQuantity = Number(window.__PREEMPT_QUANTITY__ ?? 1);
  const shouldCreatePaymentSession = Boolean(window.__PREEMPT_CREATE_PAYMENT_SESSION__);
  const pollDelayMs = Number(window.__PREEMPT_POLL_DELAY_MS__ ?? defaultPollDelayMs);
  const maxAttempts = Number(window.__PREEMPT_MAX_ATTEMPTS__ ?? defaultMaxAttempts);

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("So luong reserve khong hop le.");
  }

  const product = await getProduct(productId);
  const availableStock = Number(product.stock ?? 0);
  const quantity = Math.min(Math.max(1, Math.trunc(requestedQuantity)), Math.max(availableStock, 1));

  console.log("[preempt-manual-checkout] apiBaseUrl =", apiBaseUrl);
  console.log("[preempt-manual-checkout] product =", {
    id: product.id,
    name: product.name,
    availableStock,
    isLocked: product.isLocked,
    lockedUntil: product.lockedUntil
  });
  console.log("[preempt-manual-checkout] requestedQuantity =", requestedQuantity);
  console.log("[preempt-manual-checkout] effectiveQuantity =", quantity);
  console.log("[preempt-manual-checkout] mode = trigger (reserve truoc de tranh delay UI)");

  if (availableStock < quantity) {
    throw new Error(`San pham hien chi con ${availableStock}, khong du de reserve ${quantity}.`);
  }

  const requestId = await startCheckout(productId, quantity);
  console.log("[preempt-manual-checkout] requestId =", requestId);

  const gateResult = await pollRequest(requestId, pollDelayMs, maxAttempts);
  console.log("[preempt-manual-checkout] final gate result =", gateResult);

  let paymentSession = null;
  if (gateResult?.status === "allowed" && shouldCreatePaymentSession) {
    paymentSession = await createPaymentSession(requestId);
  }

  console.table([{
    productId,
    requestId,
    quantity,
    gateStatus: gateResult?.status ?? "",
    gateMessage: gateResult?.message ?? "",
    lockedUntil: gateResult?.lockedUntil ?? "",
    paymentUrl: paymentSession?.paymentUrl ?? ""
  }]);

  return {
    product,
    requestId,
    quantity,
    gateResult,
    paymentSession
  };
})();
