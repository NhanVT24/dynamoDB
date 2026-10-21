export function emailPublishRetryAt(attempt: number, config: {
    baseSeconds: number;
    maxSeconds: number;
}, nowMs = Date.now(), random = Math.random) {
    const delay = Math.min(config.maxSeconds, config.baseSeconds * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(random() * Math.min(30, delay));
    return new Date(nowMs + (delay + jitter) * 1000).toISOString();
}
