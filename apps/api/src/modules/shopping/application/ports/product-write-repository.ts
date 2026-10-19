import type { Product, ProductChanges, ProductStatus } from "../../domain/product.js";

/**
 * TResult is an opaque compatibility representation owned by the outer adapter.
 * Application code must never inspect it (the existing API returns legacy metadata).
 */
export interface ProductWriteRepository<TResult> {
  findById(id: string): Promise<Product | null>;

  /**
   * Atomically check existence, expectedVersion and (when supplied) ownership;
   * update the product AND its category index, increment version and reset alert
   * metadata when stock changes. Conditional failure is ProductUpdateError(CONFLICT).
   * Infrastructure failures must propagate, never be classified as conflicts.
   */
  update(input: {
    id: string;
    changes: ProductChanges;
    status: ProductStatus;
    expectedVersion: number;
    expectedOwnerId?: string;
  }): Promise<{ product: Product; representation: TResult }>;
}
