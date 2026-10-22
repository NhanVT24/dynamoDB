import { Product, type ProductStatus } from "./product.js";

// Keep the historical <= 0 rule for legacy persistence callers. Input validation
// for new writes is separate so existing records are not silently reinterpreted.
export function deriveStockStatus(stock: number): ProductStatus {
  return Product.stockStatus(stock);
}
