import "reflect-metadata";
import { createStandaloneContext } from "./core/app/create-standalone-context.js";
import { VnpayService } from "./modules/vnpay/vnpay.service.js";

type WorkflowInput = {
  detail?: {
    email?: string;
    items?: Array<{ productId: string; quantity: number }>;
  };
  orderResult?: {
    orderId?: string;
    outcome?: string;
  };
};

const appContextPromise = createStandaloneContext();

export const handler = async (event: WorkflowInput) => {
  const payload = event.detail ?? {};
  const orderResult = event.orderResult ?? {};
  const email = String(payload.email ?? "").trim().toLowerCase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const orderId = String(orderResult.orderId ?? "").trim();

  if (!email || items.length === 0) {
    throw new Error("Missing workflow payment payload.");
  }

  const appContext = await appContextPromise;
  const vnpayService = appContext.get(VnpayService);
  return vnpayService.createWorkflowPaymentUrl({
    email,
    items,
    orderId,
    orderDescription: orderId ? `Payment for order ${orderId}` : "Payment for order",
    skipStockValidation: orderResult.outcome === "success"
  });
};
