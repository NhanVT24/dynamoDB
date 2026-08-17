import "reflect-metadata";
import { createNestApp } from "./core/app/create-app.js";
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

const appPromise = createNestApp();

export const handler = async (event: WorkflowInput) => {
  const payload = event.detail ?? {};
  const orderResult = event.orderResult ?? {};
  const email = String(payload.email ?? "").trim().toLowerCase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const orderId = String(orderResult.orderId ?? "").trim();

  if (!email || items.length === 0) {
    throw new Error("Missing workflow payment payload.");
  }

  const app = await appPromise;
  const vnpayService = app.get(VnpayService);
  return vnpayService.createWorkflowPaymentUrl({
    email,
    items,
    orderId,
    orderDescription: orderId ? `Thanh toán đơn hàng ${orderId}` : "Thanh toán đơn hàng"
  });
};
