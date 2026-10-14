import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { VnpayService } from "../../../modules/vnpay/vnpay.service.js";

export const handler = async () => {
  const context = await createStandaloneContext();
  try {
    return await context.get(VnpayService).reconcileUnenqueuedPaymentEvents();
  } finally {
    await context.close();
  }
};
