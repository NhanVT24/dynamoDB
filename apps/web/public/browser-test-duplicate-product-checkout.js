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
    const product = (payload.items ?? []).find((item) => Number(item.stock ?? 0) >= 2 && !item.isLocked);
    if (!product?.id) {
      throw new Error("Khong tim thay san pham nao con it nhat 2 ton kho va chua bi lock.");
    }

    console.log("[duplicate-checkout-test] auto-picked product =", product);
    return String(product.id);
  }

  const manualProductId = String(window.__TEST_PRODUCT_ID__ ?? "").trim()
    || String(prompt("Nhap productId de test. Bam Cancel hoac de trong de tu dong chon.") ?? "").trim();
  const productId = (manualProductId || await pickProductId()).replace(/^PRODUCT#/i, "");
  const duplicatedItems = [
    { productId, quantity: 1 },
    { productId, quantity: 1 }
  ];

  console.log("[duplicate-checkout-test] apiBaseUrl =", apiBaseUrl);
  console.log("[duplicate-checkout-test] duplicatedItems =", duplicatedItems);

  const prepareResponse = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      items: duplicatedItems,
      locale: "vn"
    })
  });

  const preparePayload = await prepareResponse.json().catch(() => null);
  console.log("[duplicate-checkout-test] prepare =", prepareResponse.status, preparePayload);

  if (!prepareResponse.ok || !preparePayload?.requestId) {
    throw new Error(preparePayload?.message || "Khong tao duoc checkout gate request.");
  }

  const requestId = String(preparePayload.requestId);
  const pollDelayMs = 1500;
  const maxAttempts = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));

    const statusResponse = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${requestId}`, {
      headers: {
        Authorization: `Bearer ${idToken}`
      },
      cache: "no-store"
    });

    const statusPayload = await statusResponse.json().catch(() => null);
    console.log(`[duplicate-checkout-test] poll #${attempt}`, statusResponse.status, statusPayload);

    if (statusPayload?.status === "allowed" || statusPayload?.status === "blocked") {
      console.log("[duplicate-checkout-test] finished =", statusPayload);
      return statusPayload;
    }
  }

  throw new Error(`Polling qua ${maxAttempts} lan nhung request ${requestId} van chua ra allowed/blocked.`);
})();
