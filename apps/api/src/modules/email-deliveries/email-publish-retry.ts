import { env } from "../../config/env.js";
import { emailPublishRetryAt } from "./domain/retry-policy.js";
export function nextEmailPublishRetryAt(attempt:number,nowMs=Date.now(),random=Math.random){return emailPublishRetryAt(attempt,{baseSeconds:env.EMAIL_EVENT_PUBLISH_RETRY_BASE_SECONDS,maxSeconds:env.EMAIL_EVENT_PUBLISH_RETRY_MAX_SECONDS},nowMs,random);}
