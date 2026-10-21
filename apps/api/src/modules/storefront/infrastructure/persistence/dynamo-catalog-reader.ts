import type { CatalogProduct, CatalogQuery, CatalogReader } from "../../application/ports/catalog-reader.js";
import { getShoppingItem, listShoppingItems } from "../../../shopping/shopping.repository.js";
import type { ProductRecord } from "../../../shopping/product.types.js";
import { listActiveSaleCampaigns } from "../../../sales/sales.repository.js";

/** Explicit allowlist also protects future callers from new operational columns. */
export function catalogProjection(row: ProductRecord): CatalogProduct {
  const result: CatalogProduct = { id: String(row.id ?? ""), status: String(row.status ?? "active"), stock: Number(row.stock ?? 0) };
  for (const field of ["name", "category", "brand", "sku", "imageUrl", "location", "description", "updatedAt",
    "color", "size", "material", "voltage", "ageRange", "skinType", "expiryDate"] as const) {
    if (row[field] != null) result[field] = String(row[field]);
  }
  for (const field of ["price", "originalPrice", "rating", "soldCount", "warrantyMonths", "capacityLiters", "weightGrams"] as const) {
    if (row[field] != null) result[field] = Number(row[field]);
  }
  result.featured = Boolean(row.featured);
  return result;
}

export class DynamoCatalogReader implements CatalogReader {
  async findById(id: string) {
    const row = await getShoppingItem(id);
    return row ? catalogProjection(row) : null;
  }
  async list(query: CatalogQuery) {
    const page = await listShoppingItems(query.limit, query.cursor, query);
    return { ...page, items: page.items.map(catalogProjection) };
  }
  async activeCampaigns() {
    return (await listActiveSaleCampaigns()).map(({ id, discountPercent, productIds, endAt }) =>
      ({ id, discountPercent, productIds, endAt }));
  }
}
