import type { ProductChanges } from "../../domain/product.js";
import { deriveStockStatus } from "../../domain/stock-policy.js";
import type { InventoryAlertPublisher } from "../ports/inventory-alert-publisher.js";
import type { ProductWriteRepository } from "../ports/product-write-repository.js";
import { ProductUpdateError } from "./product-update.error.js";
import { assertCanManageProduct, type ProductActor } from "../product-access.js";

export interface UpdateProductCommand {
  readonly productId: string;
  readonly changes: ProductChanges;
  readonly expectedVersion: number;
  // This actor must be constructed from an authenticated principal by the caller.
  readonly actor: ProductActor;
}

export class UpdateProduct<TResult> {
  constructor(
    private readonly products: ProductWriteRepository<TResult>,
    private readonly alerts: InventoryAlertPublisher
  ) {}

  async execute(command: UpdateProductCommand): Promise<TResult> {
    const { productId, changes, expectedVersion, actor } = command;
    if (!productId.trim() || !actor.subject.trim() ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      (changes.stock !== undefined &&
        (!Number.isSafeInteger(changes.stock) || changes.stock < 0 || changes.stock > 999999))) {
      throw new ProductUpdateError("INVALID_INPUT", "Invalid product update");
    }

    const current = await this.products.findById(productId);
    assertCanManageProduct(current, actor);
    if (current.version !== expectedVersion) {
      throw new ProductUpdateError("CONFLICT", "Record changed, missing, or condition failed");
    }

    const status = deriveStockStatus(changes.stock ?? current.stock);
    const saved = await this.products.update({
      id: productId, changes, status, expectedVersion,
      expectedOwnerId: actor.isAdmin ? undefined : actor.subject
    });
    const updated = saved.product;

    if ((status === "low_stock" || status === "out_of_stock") && current.status !== status) {
      // Preserve existing behavior: publish is awaited AFTER commit. A publish
      // failure propagates; this does not provide atomic delivery or safe retries.
      await this.alerts.publish({
        productId: updated.id, productName: updated.name, sku: updated.sku,
        stock: updated.stock, previousStock: current.stock,
        status, previousStatus: current.status, source: "admin.update"
      });
    }
    return saved.representation;
  }
}
