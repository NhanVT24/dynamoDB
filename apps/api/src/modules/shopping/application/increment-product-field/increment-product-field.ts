import { incrementCounter, type ProductCounterField } from "../../domain/counter-policy.js";
import { deriveStockStatus } from "../../domain/stock-policy.js";
import type { InventoryAlertPublisher } from "../ports/inventory-alert-publisher.js";
import type { ProductCounterRepository } from "../ports/product-counter-repository.js";
import { assertCanManageProduct, assertProductActor, type ProductActor } from "../product-access.js";
import { ProductMutationError } from "../product-mutation.error.js";

export interface IncrementProductFieldCommand {
  productId: string;
  field: ProductCounterField;
  incrementBy: number;
  actor: ProductActor;
}

export class IncrementProductField<TResult> {
  constructor(private readonly products: ProductCounterRepository<TResult>, private readonly alerts: InventoryAlertPublisher) {}

  async execute(command: IncrementProductFieldCommand): Promise<TResult> {
    const { productId, field, incrementBy, actor } = command;
    assertProductActor(actor);
    if (!productId.trim() || (field !== "stock" && field !== "soldCount") ||
      !Number.isSafeInteger(incrementBy) || incrementBy < -99999 || incrementBy > 99999) {
      throw new ProductMutationError("INVALID_INPUT", "Invalid product increment");
    }
    const current = await this.products.findById(productId);
    assertCanManageProduct(current, actor);
    let nextValue: number;
    try {
      nextValue = incrementCounter(current[field], incrementBy);
    } catch (error) {
      if (error instanceof RangeError) throw new ProductMutationError("INVALID_INPUT", error.message);
      throw error;
    }
    const status = deriveStockStatus(field === "stock" ? nextValue : current.stock);
    const saved = await this.products.increment({
      id: productId, field, incrementBy, nextValue, status, expectedVersion: current.version,
      expectedOwnerId: actor.isAdmin ? undefined : actor.subject
    });
    if ((status === "low_stock" || status === "out_of_stock") && current.status !== status) {
      await this.alerts.publish({
        productId: saved.product.id, productName: saved.product.name, sku: saved.product.sku,
        stock: saved.product.stock, previousStock: current.stock, status,
        previousStatus: current.status, source: "admin.increment"
      });
    }
    return saved.representation;
  }
}
