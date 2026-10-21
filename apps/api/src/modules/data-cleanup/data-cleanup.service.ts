import { CleanupData } from "./application/cleanup-data.js";
import * as store from "./data-cleanup.repository.js";
const cleanup = new CleanupData(store);
export function runScheduledDataCleanup(now = new Date()) { return cleanup.execute(now); }
