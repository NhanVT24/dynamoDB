import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { RecoverPayments } from "../../../modules/vnpay/application/recover-payments.js";
import { auditContext, serviceAuditContext } from "../../../modules/audit-log/audit-context.js";

export const handler = async (_event?: unknown, lambdaContext?: { awsRequestId?: string }) => {
  const context = await createStandaloneContext();
  return auditContext.run(serviceAuditContext({ actorId: "lambda:reconcile-payment-events", source: "PAYMENT_RECONCILIATION",
    reason: "scheduled_reconcile_payment_events", requestId: lambdaContext?.awsRequestId }),
    () => context.get(RecoverPayments).execute());
};
