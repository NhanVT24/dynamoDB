export class RetrySchedule {
    constructor(private readonly attempt: number, private readonly config: {
        baseSeconds: number;
        maxSeconds: number;
    }) { }
    at(nowMs: number, random: () => number) {
        const attempt = this.attempt, config = this.config;
        const delay = Math.min(config.maxSeconds, config.baseSeconds * 2 ** Math.max(0, attempt - 1));
        const jitter = Math.floor(random() * Math.min(30, delay));
        return new Date(nowMs + (delay + jitter) * 1000).toISOString();
    }
}
