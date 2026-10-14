import "reflect-metadata";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { StorefrontService } from "../../../modules/storefront/storefront.service.js";

export const handler = async () => {
  const context = await createStandaloneContext();
  try {
    return await context.get(StorefrontService).reconcilePendingRefunds();
  } finally {
    await context.close();
  }
};
