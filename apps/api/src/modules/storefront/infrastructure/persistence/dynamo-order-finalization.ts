import { createStorefrontOrder } from "./storefront.store.js";
import { InsufficientOrderStock } from "../../application/ports/order-finalization-ports.js";
import type { OrderFinalizationRepository } from "../../application/ports/order-finalization-ports.js";

export class DynamoOrderFinalization implements OrderFinalizationRepository {
  async commit(email: string, items: Parameters<OrderFinalizationRepository["commit"]>[1], requestId: string) {
    try { return await createStorefrontOrder({ email, items, requestId }); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("Insufficient stock for ")) throw new InsufficientOrderStock(error.message);
      throw error;
    }
  }
}
