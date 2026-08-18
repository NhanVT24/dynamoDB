import "reflect-metadata";
import { createStandaloneContext } from "./core/app/create-standalone-context.js";
import { StorefrontService } from "./modules/storefront/storefront.service.js";

type WorkflowInput = {
  detail?: {
    email?: string;
    requestId?: string;
    items?: Array<{ productId: string; quantity: number }>;
  };
};

const appContextPromise = createStandaloneContext();

export const handler = async (event: WorkflowInput) => {
  const payload = event.detail ?? {};
  const email = String(payload.email ?? "").trim().toLowerCase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const requestId = String(payload.requestId ?? "").trim();

  if (!email || items.length === 0) {
    throw new Error("Missing workflow order payload.");
  }

  const appContext = await appContextPromise;
  const storefrontService = appContext.get(StorefrontService);
  return storefrontService.finalizeWorkflowOrder({
    email,
    items,
    requestId
  });
};
