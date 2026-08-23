(async () => {
  const apiBaseUrl = (window.__STORE_API_BASE_URL__
    || `${location.origin}/api/lambda-proxy`).replace(/\/+$/, "");
  const authStorageCandidates = [
    "cognito-auth-session",
    "web-auth-session",
    "auth-session"
  ];

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

  async function pickProductId() {
    const response = await fetch(`${apiBaseUrl}/api/storefront/products?limit=24`, {
      headers: {
        Authorization: `Bearer ${idToken}`
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Khong the lay danh sach san pham, status=${response.status}.`);
    }

    const payload = await response.json();
    const product = (payload.items ?? []).find((item) => Number(item.stock ?? 0) >= 1 && !item.isLocked);
    if (!product?.id) {
      throw new Error("Khong tim thay san pham nao con ton kho va chua bi reserve.");
    }

    console.log("[duplicate-checkout-test] auto-picked product =", product);
    return String(product.id);
  }

  async function startCheckout(label, productId) {
    const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        items: [{ productId, quantity: 1 }],
        locale: "vn",
        processingMode: "trigger"
      })
    });

    const payload = await response.json().catch(() => null);
    console.log(`[duplicate-checkout-test] ${label} prepare =`, response.status, payload);

    if (!response.ok || !payload?.requestId) {
      throw new Error(`${label}: ${payload?.message || "Khong tao duoc checkout gate request."}`);
    }

    return String(payload.requestId);
  }

  async function pollRequest(label, requestId) {
    const pollDelayMs = 400;
    const maxAttempts = 20;

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

    throw new Error(`${label}: Polling qua ${maxAttempts} lan nhung request ${requestId} van chua ra allowed/blocked.`);
  }

  const manualProductId = String(window.__TEST_PRODUCT_ID__ ?? "").trim()
    || String(prompt("Nhap productId de test. Bam Cancel hoac de trong de tu dong chon.") ?? "").trim();
  const productId = (manualProductId || await pickProductId()).replace(/^PRODUCT#/i, "");

  console.log("[duplicate-checkout-test] apiBaseUrl =", apiBaseUrl);
  console.log("[duplicate-checkout-test] productId =", productId);
  console.log("[duplicate-checkout-test] mode = trigger (no artificial delay)");

  const [requestIdA, requestIdB] = await Promise.all([
    startCheckout("request-A", productId),
    startCheckout("request-B", productId)
  ]);

  console.log("[duplicate-checkout-test] request ids =", { requestIdA, requestIdB });

  const results = await Promise.all([
    pollRequest("request-A", requestIdA),
    pollRequest("request-B", requestIdB)
  ]);

  console.table(results.map((item) => ({
    label: item.label,
    requestId: item.requestId,
    status: item.status,
    message: item.payload?.message ?? ""
  })));

  return results;
})();
