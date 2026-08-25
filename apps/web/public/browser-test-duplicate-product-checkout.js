(async () => {
  const apiBaseUrl = (window.__STORE_API_BASE_URL__
    || `${location.origin}/api/lambda-proxy`).replace(/\/+$/, "");
  const authStorageCandidates = [
    "cognito-auth-session",
    "web-auth-session",
    "auth-session"
  ];
  const defaultProductId = "506284f1-bdac-4241-83ce-99454e09a87e";
  const requestCount = Math.max(2, Math.trunc(Number(window.__DUPLICATE_CHECKOUT_COUNT__ ?? 5)));
  const quantity = Math.max(1, Math.trunc(Number(window.__DUPLICATE_CHECKOUT_QUANTITY__ ?? 1)));
  const pollDelayMs = Math.max(200, Math.trunc(Number(window.__DUPLICATE_CHECKOUT_POLL_DELAY_MS__ ?? 400)));
  const maxAttempts = Math.max(10, Math.trunc(Number(window.__DUPLICATE_CHECKOUT_MAX_ATTEMPTS__ ?? 30)));

  const authRaw = authStorageCandidates
    .map((key) => window.localStorage.getItem(key))
    .find(Boolean);

  if (!authRaw) {
    throw new Error("Not found any auth session in localStorage. Please login first.");
  }

  const auth = JSON.parse(authRaw);
  const idToken = String(auth?.idToken ?? "").trim();
  if (!idToken) {
    throw new Error("Session does not contain idToken. Please login first.");
  }

  async function pickProductId() {
    const response = await fetch(`${apiBaseUrl}/api/storefront/products?limit=24`, {
      headers: {
        Authorization: `Bearer ${idToken}`
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Cannot fetch product list, status=${response.status}.`);
    }

    const payload = await response.json();
    const product = (payload.items ?? []).find((item) => Number(item.stock ?? 0) >= 1 && !item.isLocked);
    if (!product?.id) {
      throw new Error("Not found any product with available stock and not reserved.");
    }

    console.log("[duplicate-checkout-test] auto-picked product =", product);
    return String(product.id);
  }

  async function getProduct(productId) {
    const headers = {
      Authorization: `Bearer ${idToken}`
    };
    const candidates = [
      `${apiBaseUrl}/api/storefront/products/${productId}`,
      `${apiBaseUrl}/api/products/${productId}`
    ];

    let response = null;
    let payload = null;
    for (const url of candidates) {
      response = await fetch(url, {
        headers,
        cache: "no-store"
      });
      payload = await response.json().catch(() => null);

      if (response.ok && payload?.id) {
        return payload;
      }

      console.warn("[duplicate-checkout-test] product lookup failed =", {
        url,
        status: response.status,
        message: payload?.message ?? ""
      });
    }

    throw new Error(payload?.message || `Cannot fetch product information for ${productId}.`);
  }

  async function startCheckout(label, productId) {
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
    console.log(`[duplicate-checkout-test] ${label} prepare =`, response.status, payload);

    if (!response.ok || !payload?.requestId) {
      throw new Error(`${label}: ${payload?.message || "Cannot create checkout gate request."}`);
    }

    return String(payload.requestId);
  }

  async function pollRequest(label, requestId) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));

      const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${requestId}`, {
        headers: {
          Authorization: `Bearer ${idToken}`
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      console.log(`[duplicate-checkout-test] ${label} poll #${attempt}`, response.status, payload);

      if (payload?.status === "allowed" || payload?.status === "blocked") {
        return {
          label,
          requestId,
          status: payload.status,
          payload
        };
      }
    }

    throw new Error(`${label}: Polling exceeded ${maxAttempts} attempts for request ${requestId}.`);
  }

  const manualProductId = String(window.__TEST_PRODUCT_ID__ ?? "").trim()
    || String(window.__DUPLICATE_CHECKOUT_PRODUCT_ID__ ?? "").trim()
    || defaultProductId;
  const productId = (manualProductId || await pickProductId()).replace(/^PRODUCT#/i, "");
  const productBefore = await getProduct(productId);

  console.log("[duplicate-checkout-test] apiBaseUrl =", apiBaseUrl);
  console.log("[duplicate-checkout-test] productId =", productId);
  console.log("[duplicate-checkout-test] product before =", {
    id: productBefore.id,
    name: productBefore.name,
    stock: productBefore.stock,
    status: productBefore.status,
    isLocked: productBefore.isLocked,
    lockedUntil: productBefore.lockedUntil
  });
  console.log("[duplicate-checkout-test] requestCount =", requestCount);
  console.log("[duplicate-checkout-test] quantity =", quantity);
  console.log("[duplicate-checkout-test] mode = trigger (no artificial delay)");

  const labels = Array.from({ length: requestCount }, (_, index) => `request-${index + 1}`);
  const requestIds = await Promise.all(labels.map((label) => startCheckout(label, productId)));

  console.log("[duplicate-checkout-test] request ids =", Object.fromEntries(labels.map((label, index) => [label, requestIds[index]])));

  const results = await Promise.all(labels.map((label, index) => pollRequest(label, requestIds[index])));
  const productAfter = await getProduct(productId);

  console.table(results.map((item) => ({
    label: item.label,
    requestId: item.requestId,
    status: item.status,
    message: item.payload?.message ?? ""
  })));
  console.table([{
    productId,
    beforeStock: productBefore.stock,
    afterStock: productAfter.stock,
    beforeStatus: productBefore.status,
    afterStatus: productAfter.status,
    afterIsLocked: productAfter.isLocked,
    allowedCount: results.filter((item) => item.status === "allowed").length,
    blockedCount: results.filter((item) => item.status === "blocked").length
  }]);

  window.__LAST_DUPLICATE_CHECKOUT_RESULTS__ = {
    productBefore,
    productAfter,
    results
  };

  return window.__LAST_DUPLICATE_CHECKOUT_RESULTS__;
})();
