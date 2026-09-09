import "reflect-metadata";
import { releaseExpiredAwaitingPaymentOrders } from "../../../modules/storefront/storefront.repository.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-schedule:release-expired-orders] received", JSON.stringify(event));

  const releasedOrders = await releaseExpiredAwaitingPaymentOrders();
  const releasedCount = releasedOrders;

  return {
    ok: true,
    releasedCount,
    checkedAt: new Date().toISOString()
  };
};
