import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { ReadWorkflowPayment } from "../../../modules/storefront/application/workflow-checkout/workflow-checkout.js";

type WorkflowInput = { detail?: { email?: string }; orderResult?: { orderId?: string; outcome?: string } };

export const handler = async (event: WorkflowInput) => {
  const email = String(event.detail?.email ?? "").trim().toLowerCase();
  const orderId = String(event.orderResult?.orderId ?? "").trim();
  if (!email || !orderId || event.orderResult?.outcome !== "success") throw new Error("Missing workflow payment payload.");
  const context = await createStandaloneContext();
  // Reuse the attached session. Step Functions retry must not create another URL.
  return context.get(ReadWorkflowPayment).execute(email, orderId);
};
