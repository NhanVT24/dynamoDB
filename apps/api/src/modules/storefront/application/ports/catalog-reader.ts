import type { ProductChanges } from "../../../shopping/domain/product.js";
import type { PricingCampaign } from "../../../sales/domain/sale-pricing.js";

/** Read projection: no ownership, index keys, audit data or notification flags. */
export type CatalogProduct = ProductChanges & {
  id: string; status: string; stock: number; updatedAt?: string;
};
export interface CatalogQuery {
  limit: number; cursor?: string; category?: string; status?: string; updatedAtFrom?: string;
  searchField: "name" | "brand"; search?: string;
  sortBy?: "price" | "stock" | "updatedAt"; sortDirection?: "asc" | "desc";
}
export interface CatalogPage {
  items: CatalogProduct[]; limit: number; cursor?: string | null; nextCursor?: string | null; hasNextPage: boolean;
}
export interface CatalogReader {
  findById(id: string): Promise<CatalogProduct | null>;
  list(query: CatalogQuery): Promise<CatalogPage>;
  activeCampaigns(): Promise<PricingCampaign[]>;
}
