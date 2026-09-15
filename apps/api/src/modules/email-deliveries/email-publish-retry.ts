import { env } from "../../config/env.js";

export function nextEmailPublishRetryAt(
  completedAttempt: number,
  nowMs = Date.now(),
  random = Math.random
) {
  const exponentialSeconds = env.EMAIL_EVENT_PUBLISH_RETRY_BASE_SECONDS
    * 2 ** Math.max(0, completedAttempt - 1);
  const delaySeconds = Math.min(env.EMAIL_EVENT_PUBLISH_RETRY_MAX_SECONDS, exponentialSeconds);
  const jitterSeconds = Math.floor(random() * Math.min(30, delaySeconds));
  return new Date(nowMs + (delaySeconds + jitterSeconds) * 1_000).toISOString();
}

