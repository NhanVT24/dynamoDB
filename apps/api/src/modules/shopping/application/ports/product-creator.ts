import type { Product } from "../../domain/product.js";

export interface ProductCreator<TResult> {
  /** Create the product and dependent views atomically; existing identity is CONFLICT. */
  create(input: {
    product: Product;
    createdAt: string;
    updatedAt: string;
  }): Promise<TResult>;
}
