import type { NewProductDetails } from "../../domain/product.js";
import { deriveStockStatus } from "../../domain/stock-policy.js";
import type { ProductCreator } from "../ports/product-creator.js";
import { assertProductActor, type ProductActor } from "../product-access.js";
import { ProductMutationError } from "../product-mutation.error.js";

export class CreateProduct<TResult> {
  constructor(
    private readonly products: ProductCreator<TResult>,
    private readonly newId: () => string,
    private readonly now: () => Date
  ) {}

  async execute(command: { details: NewProductDetails; actor: ProductActor }): Promise<TResult> {
    assertProductActor(command.actor);
    const { details } = command;
    if (!Number.isSafeInteger(details.stock) || details.stock < 0 || details.stock > 999999) {
      throw new ProductMutationError("INVALID_INPUT", "Invalid product stock");
    }
    // Full transport validation remains at the HTTP schema. These defaults also
    // make typed internal callers independent of HTTP/Zod's default handling.
    const normalized = { ...details, rating: details.rating ?? 4.8,
      soldCount: details.soldCount ?? 0, featured: details.featured ?? false };
    const timestamp = this.now().toISOString();
    return this.products.create({
      id: this.newId(), ownerId: command.actor.subject, details: normalized,
      status: deriveStockStatus(details.stock), createdAt: timestamp, updatedAt: timestamp
    });
  }
}
