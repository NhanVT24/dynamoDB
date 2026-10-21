import type { CatalogProduct, CatalogQuery, CatalogReader } from "../ports/catalog-reader.js";
import { resolveSalePrice } from "../../../sales/domain/sale-pricing.js";
import type { PricingCampaign } from "../../../sales/domain/sale-pricing.js";
import { ProductMutationError } from "../../../shopping/application/product-mutation.error.js";
import { deriveStockStatus } from "../../../shopping/domain/stock-policy.js";

function summary(item: CatalogProduct, campaigns: PricingCampaign[]) {
  const stock = Number(item.stock ?? 0);
  return {
    id: item.id, name: String(item.name ?? ""), category: String(item.category ?? ""), brand: String(item.brand ?? ""),
    ...resolveSalePrice(item, campaigns),
    status: stock > 10 ? item.status : deriveStockStatus(stock),
    stock, imageUrl: item.imageUrl, rating: item.rating, soldCount: item.soldCount,
    location: item.location, featured: Boolean(item.featured), updatedAt: item.updatedAt, isLocked: false
  };
}

export class ListProducts {
  constructor(private readonly catalog: CatalogReader) {}
  async execute(query: CatalogQuery) {
    const page = await this.catalog.list(query);
    const campaigns = await this.catalog.activeCampaigns();
    return {
      // Preserve the database cursor even when this page contains only sold-out products.
      items: page.items.filter(item => item.stock > 0).map(item => summary(item, campaigns)),
      pageInfo: { limit: page.limit, cursor: page.cursor, nextCursor: page.nextCursor, hasNextPage: page.hasNextPage }
    };
  }
}

export class GetProduct {
  constructor(private readonly catalog: CatalogReader) {}
  async execute(id: string) {
    const item = await this.catalog.findById(id);
    if (!item || !(item.stock > 0)) throw new ProductMutationError("NOT_FOUND", "Not found product.");
    const attributes: Record<string, string | number> = {};
    for (const field of ["color", "size", "material", "warrantyMonths", "voltage", "capacityLiters",
      "ageRange", "skinType", "weightGrams", "expiryDate"] as const) {
      const value = item[field];
      if (value !== undefined) attributes[field] = value;
    }
    return { ...summary(item, await this.catalog.activeCampaigns()),
      description: item.description, sku: item.sku, attributes };
  }
}
