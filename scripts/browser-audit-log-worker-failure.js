// Paste this whole snippet into the browser DevTools Console while logged in as admin.
// It injects one intentionally invalid audit-log message, then polls the Worker DLQ.
(async () => {
  const apiBase = String(window.AUDIT_LOG_TEST_API_BASE || window.location.origin).replace(/\/$/, "");
  const sessionRaw = window.localStorage.getItem("cognito-auth-session");
  if (!sessionRaw) throw new Error("No cognito-auth-session found. Sign in as admin first.");

  const session = JSON.parse(sessionRaw);
  if (!session?.accessToken) throw new Error("No accessToken found in cognito-auth-session.");

  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json"
  };
  const testId = `browser-${Date.now()}`;

  async function request(path, init) {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers || {}) }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
    }
    return body;
  }

  console.log("[audit-log-test] injecting invalid worker message", { apiBase, testId });
  const injected = await request("/api/admin/ops/audit-log/worker-failure-test", {
    method: "POST",
    body: JSON.stringify({ testId })
  });
  console.log("[audit-log-test] injected", injected);

  for (let attempt = 1; attempt <= 18; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const dlq = await request("/api/admin/ops/dlq?queue=auditLogWorker&maxMessages=10");
    const messages = dlq?.messages || [];
    const matched = messages.find((message) => {
      try {
        return JSON.parse(message.body)?.testId === testId;
      } catch {
        return false;
      }
    });
    console.log("[audit-log-test] dlq poll", {
      attempt,
      messageCount: dlq?.messageCount,
      notVisibleCount: dlq?.notVisibleCount,
      matched: Boolean(matched)
    });
    if (matched) {
      console.log("[audit-log-test] matched DLQ message", matched);
      return { injected, dlqMessage: matched };
    }
  }

  console.warn("[audit-log-test] not in DLQ yet. Worker retries may still be running; inspect Lambda logs and poll /api/admin/ops/dlq?queue=auditLogWorker&maxMessages=10 later.");
  return { injected };
})();

