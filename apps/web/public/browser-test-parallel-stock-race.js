(async () => {
  const apiBaseUrl = (window.__STORE_API_BASE_URL__
    || `${location.origin}/api/lambda-proxy`).replace(/\/+$/, "");
  const productId = String(window.__PARALLEL_STOCK_PRODUCT_ID__
    || "506284f1-bdac-4241-83ce-99454e09a87e").replace(/^PRODUCT#/i, "");
  const requestCount = Math.max(2, Math.trunc(Number(window.__PARALLEL_STOCK_REQUEST_COUNT__ ?? 5)));
  const quantity = Math.max(1, Math.trunc(Number(window.__PARALLEL_STOCK_QUANTITY__ ?? 1)));
  const pollDelayMs = Math.max(200, Math.trunc(Number(window.__PARALLEL_STOCK_POLL_DELAY_MS__ ?? 400)));
  const maxPollAttempts = Math.max(10, Math.trunc(Number(window.__PARALLEL_STOCK_MAX_POLL_ATTEMPTS__ ?? 140)));
  const pendingLogEvery = Math.max(1, Math.trunc(Number(window.__PARALLEL_STOCK_PENDING_LOG_EVERY__ ?? 5)));
  // Low-traffic SQS Pipes can wait about 20 seconds even with a short batching window.
  const maxPendingMs = Math.max(5000, Math.trunc(Number(window.__PARALLEL_STOCK_MAX_PENDING_MS__ ?? 45000)));
  const raceTestId = window.crypto?.randomUUID?.();
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

  const authHeaders = {
    Authorization: `Bearer ${idToken}`
  };

  function nowLabel() {
    return new Date().toISOString();
  }

  function assertNotStopped() {
    if (window.__STOP_PARALLEL_STOCK_RACE__) {
      throw new Error("Parallel stock race test stopped by window.__STOP_PARALLEL_STOCK_RACE__.");
    }
  }

  async function readJson(response) {
    return response.json().catch(() => null);
  }

  async function getProductSnapshot(label) {
    const candidates = [
      `${apiBaseUrl}/api/products/${productId}`,
      `${apiBaseUrl}/api/storefront/products/${productId}`
    ];

    for (const url of candidates) {
      const response = await fetch(url, {
        headers: authHeaders,
        cache: "no-store"
      });
      const payload = await readJson(response);

      if (response.ok && payload?.id) {
        const snapshot = {
          label,
          id: payload.id,
          name: payload.name,
          stock: payload.stock,
          status: payload.status,
          isLocked: payload.isLocked,
          lockedUntil: payload.lockedUntil
        };
        console.table([snapshot]);
        return snapshot;
      }

      console.warn("[parallel-stock-race] product snapshot skipped =", {
        label,
        url,
        status: response.status,
        message: payload?.message ?? ""
      });
    }

    return null;
  }

  async function prepareCheckout(label) {
    assertNotStopped();
    const startedAt = performance.now();
    const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify({
        items: [{ productId, quantity }],
        locale: "vn",
        processingMode: "trigger",
        raceTestId
      })
    });
    const payload = await readJson(response);
    const elapsedMs = Math.round(performance.now() - startedAt);

    console.log(`[parallel-stock-race] ${label} prepare`, {
      statusCode: response.status,
      elapsedMs,
      requestId: payload?.requestId,
      status: payload?.status,
      message: payload?.message
    });

    if (!response.ok || !payload?.requestId) {
      throw new Error(`${label}: ${payload?.message || `prepare failed, status=${response.status}`}`);
    }

    return {
      label,
      requestId: String(payload.requestId),
      prepareStatusCode: response.status,
      prepareElapsedMs: elapsedMs,
      preparePayload: payload
    };
  }

  async function pollCheckout(prepared, abortSignal) {
    const startedAt = performance.now();
    let lastStatus = "";

    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      assertNotStopped();
      if (abortSignal?.aborted) {
        return {
          ...prepared,
          finalStatusCode: 0,
          finalStatus: "pending_stopped",
          finalMessage: "Stopped polling because the test reached the pending wait limit.",
          lockedUntil: "",
          pollElapsedMs: Math.round(performance.now() - startedAt),
          pollAttempts: attempt - 1,
          finalPayload: null
        };
      }

      await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));

      const response = await fetch(`${apiBaseUrl}/api/storefront/checkout/prepare/${prepared.requestId}`, {
        headers: authHeaders,
        cache: "no-store"
      });
      const payload = await readJson(response);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const status = String(payload?.status ?? "");
      const shouldLog = status !== lastStatus
        || status === "allowed"
        || status === "blocked"
        || attempt % pendingLogEvery === 0
        || attempt === maxPollAttempts;

      if (shouldLog) {
        console.log(`[parallel-stock-race] ${prepared.label} poll #${attempt}`, {
          statusCode: response.status,
          elapsedMs,
          requestId: prepared.requestId,
          status,
          message: payload?.message
        });
      }
      lastStatus = status;

      if (payload?.status === "allowed" || payload?.status === "blocked") {
        return {
          ...prepared,
          finalStatusCode: response.status,
          finalStatus: payload.status,
          finalMessage: payload.message ?? "",
          lockedUntil: payload.lockedUntil ?? "",
          pollElapsedMs: elapsedMs,
          pollAttempts: attempt,
          finalPayload: payload
        };
      }
    }

    throw new Error(`${prepared.label}: request ${prepared.requestId} van pending sau ${maxPollAttempts} lan poll.`);
  }

  console.log("[parallel-stock-race] config", {
    apiBaseUrl,
    productId,
    requestCount,
    quantity,
    pollDelayMs,
    maxPollAttempts,
    pendingLogEvery,
    maxPendingMs,
    raceTestId,
    startedAt: nowLabel()
  });
  console.log("[parallel-stock-race] stop command: window.__STOP_PARALLEL_STOCK_RACE__ = true");
  window.__STOP_PARALLEL_STOCK_RACE__ = false;

  const before = await getProductSnapshot("before");
  const labels = Array.from({ length: requestCount }, (_, index) => `request-${index + 1}`);

  console.time("[parallel-stock-race] prepare-all");
  const prepared = await Promise.all(labels.map((label) => prepareCheckout(label)));
  console.timeEnd("[parallel-stock-race] prepare-all");

  const abortController = new AbortController();
  const stopTimerId = window.setTimeout(() => {
    abortController.abort();
    console.warn("[parallel-stock-race] stop polling pending requests after wait limit", {
      maxPendingMs
    });
  }, maxPendingMs);

  console.time("[parallel-stock-race] poll-all");
  const results = await Promise.all(prepared.map((item) => pollCheckout(item, abortController.signal)));
  window.clearTimeout(stopTimerId);
  console.timeEnd("[parallel-stock-race] poll-all");

  const after = await getProductSnapshot("after");
  const rows = results.map((item) => ({
    label: item.label,
    requestId: item.requestId,
    status: item.finalStatus,
    prepareMs: item.prepareElapsedMs,
    pollMs: item.pollElapsedMs,
    attempts: item.pollAttempts,
    message: item.finalMessage
  }));

  const summary = {
    productId,
    requestCount,
    quantity,
    allowed: results.filter((item) => item.finalStatus === "allowed").length,
    blocked: results.filter((item) => item.finalStatus === "blocked").length,
    pendingStopped: results.filter((item) => item.finalStatus === "pending_stopped").length,
    beforeStock: before?.stock,
    afterStock: after?.stock,
    afterStatus: after?.status,
    afterIsLocked: after?.isLocked,
    finishedAt: nowLabel()
  };

  const requestIdsForCloudWatch = results.map((item) => item.requestId).join("|");
  const cloudWatchQuery = [
    'fields @timestamp, @message',
    '| filter @message like /CHECKOUT_TX_RACE/',
    `| filter @message like /${productId}/ or @message like /${requestIdsForCloudWatch}/`,
    '| sort @timestamp asc',
    '| limit 100'
  ].join("\\n");

  console.table(rows);
  console.table([summary]);
  console.log("[parallel-stock-race] CloudWatch Logs Insights query (log group: /aws/lambda/supermarket-checkout-gate-worker-aws):\\n" + cloudWatchQuery);

  window.__LAST_PARALLEL_STOCK_RACE__ = {
    config: {
      apiBaseUrl,
      productId,
      requestCount,
      quantity,
      pollDelayMs,
      maxPollAttempts,
      pendingLogEvery,
      maxPendingMs
      ,
      raceTestId
    },
    before,
    after,
    results,
    summary,
    cloudWatchQuery
  };

  return window.__LAST_PARALLEL_STOCK_RACE__;
})();
