import { RetrySchedule } from "./retry-schedule.js";
export function emailPublishRetryAt(attempt: number, config: { baseSeconds: number; maxSeconds: number }, nowMs = Date.now(), random = Math.random) {
 return new RetrySchedule(attempt, config).at(nowMs, random);
}
