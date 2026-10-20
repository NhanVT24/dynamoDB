import type { NewProductDetails, ProductStatus } from "../../domain/product.js";

export interface ProductCreator<TResult> {
  /** Create the product and dependent views atomically; existing identity is CONFLICT. */
  create(input: {
    id: string;
    ownerId: string;
    details: NewProductDetails;
    status: ProductStatus;
    createdAt: string;
    updatedAt: string;
  }): Promise<TResult>;
}
