import "reflect-metadata";
import { createNestApp } from "./core/app/create-app.js";
import { StorefrontService } from "./modules/storefront/storefront.service.js";

type WorkflowInput = {
  detail?: {
    email?: string;
    requestId?: string;
    items?: Array<{ productId: string; quantity: number }>;
  };
};

const appPromise = createNestApp();

export const handler = async (event: WorkflowInput) => {
  const payload = event.detail ?? {};
  const email = String(payload.email ?? "").trim().toLowerCase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const requestId = String(payload.requestId ?? "").trim();

  if (!email || items.length === 0) {
    throw new Error("Missing workflow order payload.");
  }

  const app = await appPromise;
  const storefrontService = app.get(StorefrontService);
  return storefrontService.finalizeWorkflowOrder({
    email,
    items,
    requestId
  });
};
