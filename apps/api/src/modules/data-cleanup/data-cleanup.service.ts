import {
  deleteCleanupCandidates,
  listCleanupCandidates,
  markDataCleanupCompleted,
  tryStartDataCleanup
} from "./data-cleanup.repository.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function runScheduledDataCleanup(now = new Date()) {
  if (!await tryStartDataCleanup(now)) {
    return { ran: false, reason: "not_due_or_already_running" as const };
  }

  const shortLivedCutoff = new Date(now.getTime() - THREE_DAYS_MS).toISOString();
  const reportCutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
  const cleanupPlans = [
    {
      name: "readNotifications",
      entityType: "NOTIFICATION" as const,
      updatedBefore: shortLivedCutoff,
      isEligible: (item: { status?: string; isRead?: boolean }) => item.isRead === true || item.status === "read"
    },
    {
      name: "terminalCheckoutGates",
      entityType: "CHECKOUT_GATE" as const,
      updatedBefore: shortLivedCutoff,
      isEligible: (item: { status?: string }) => item.status === "blocked" || item.status === "completed"
    },
    {
      name: "terminalCheckoutReservations",
      entityType: "CHECKOUT_RESERVATION" as const,
      updatedBefore: shortLivedCutoff,
      isEligible: (item: { status?: string }) => item.status === "released" || item.status === "committed"
    },
    {
      name: "inventoryReportAudit",
      entityType: "INVENTORY_DAILY_REPORT" as const,
      updatedBefore: reportCutoff,
      isEligible: () => true
    }
  ];

  const counts: Record<string, number> = {};
  let hasRemainingBacklog = false;

  for (const plan of cleanupPlans) {
    const result = await listCleanupCandidates(plan);
    counts[plan.name] = await deleteCleanupCandidates(result.candidates);
    hasRemainingBacklog ||= result.hasRemainingBacklog;
  }

  await markDataCleanupCompleted({ hasRemainingBacklog, now });
  return { ran: true, counts, hasRemainingBacklog };
}
