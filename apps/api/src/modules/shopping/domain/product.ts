export const productStatuses = ["active", "low_stock", "out_of_stock"] as const;
export type ProductStatus = typeof productStatuses[number];

/** Business data needed by product updates, independent of storage/auth providers. */
export interface Product {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly sku?: string;
  readonly stock: number;
  readonly status: string;
  readonly version: number;
}

/** Editable business fields. Persistence keys and operational metadata are excluded. */
export interface ProductChanges {
  name?: string;
  category?: string;
  brand?: string;
  sku?: string;
  stock?: number;
  price?: number;
  originalPrice?: number;
  imageUrl?: string;
  location?: string;
  description?: string;
  rating?: number;
  soldCount?: number;
  featured?: boolean;
  color?: string;
  size?: string;
  material?: string;
  warrantyMonths?: number;
  voltage?: string;
  capacityLiters?: number;
  ageRange?: string;
  skinType?: string;
  weightGrams?: number;
  expiryDate?: string;
}
