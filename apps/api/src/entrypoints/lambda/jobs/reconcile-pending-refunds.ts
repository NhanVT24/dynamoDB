import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { ReconcilePendingRefunds } from "../../../modules/storefront/application/reconcile-pending-refunds/reconcile-pending-refunds.js";
import { auditContext, serviceAuditContext } from "../../../modules/audit-log/audit-context.js";

export const handler = async (_event?: unknown, lambdaContext?: { awsRequestId?: string }) => {
  const context = await createStandaloneContext();
  // This helper caches the context across warm invocations. Do not close the
  // shared instance and return a closed container on the next invocation.
  return auditContext.run(serviceAuditContext({ actorId: "lambda:reconcile-pending-refunds",
    source: "REFUND_RECONCILIATION", reason: "scheduled_refund_reconciliation", requestId: lambdaContext?.awsRequestId }),
  () => context.get(ReconcilePendingRefunds).execute());
};
