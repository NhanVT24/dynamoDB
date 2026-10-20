import type { Product } from "../domain/product.js";
import { ProductMutationError } from "./product-mutation.error.js";

export interface ProductActor {
  readonly subject: string;
  readonly isAdmin: boolean;
}

export function assertProductActor(actor: ProductActor): void {
  if (!actor.subject.trim()) throw new ProductMutationError("INVALID_INPUT", "Invalid product actor");
}

export function assertCanManageProduct(product: Product | null, actor: ProductActor): asserts product is Product {
  if (!product) throw new ProductMutationError("NOT_FOUND", "Product not found");
  if (!actor.isAdmin && product.ownerId !== actor.subject) {
    throw new ProductMutationError("FORBIDDEN", "You can only modify products that you created.");
  }
}
