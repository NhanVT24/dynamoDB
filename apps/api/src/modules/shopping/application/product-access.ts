import type { Product } from "../domain/product.js";
import { ProductMutationError } from "./product-mutation.error.js";
import type { ProductActor } from "../domain/product.js";
export type { ProductActor } from "../domain/product.js";

export function assertProductActor(actor: ProductActor): void {
  if (!actor.subject.trim()) throw new ProductMutationError("INVALID_INPUT", "Invalid product actor");
}

export function assertCanManageProduct(product: Product | null, actor: ProductActor): asserts product is Product {
  if (!product) throw new ProductMutationError("NOT_FOUND", "Product not found");
  product.assertCanBeManagedBy(actor);
}
