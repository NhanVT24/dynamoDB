import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { ExpireOrders } from "../../../modules/storefront/application/expire-orders/expire-orders.js";
import { auditContext, serviceAuditContext } from "../../../modules/audit-log/audit-context.js";

export const handler = async (_event?: unknown, lambdaContext?: { awsRequestId?: string }) => {
  const context = await createStandaloneContext();
  return auditContext.run(serviceAuditContext({ actorId: "lambda:release-expired-orders", source: "ORDER_EXPIRY_WORKER",
    reason: "scheduled_release_expired_orders", requestId: lambdaContext?.awsRequestId }),
    () => context.get(ExpireOrders).execute());
};
