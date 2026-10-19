import type { ProductStatus } from "./domain/product.js";
export { productStatuses } from "./domain/product.js";
export type { ProductStatus } from "./domain/product.js";

// A DynamoDB product can carry operational metadata (audit fields, secondary
// index helpers, alert timestamps). Keep that extension space explicit as
// `unknown`; product code may only use it after narrowing/conversion.
export type ProductRecord = Record<string, unknown> & {
  PK?: string;
  SK?: string;
  entityType?: "PRODUCT";
  id?: string;
  ownerSub?: string;

  name?: string;
  category?: string;
  brand?: string;
  sku?: string;
  price?: number;
  originalPrice?: number;
  stock?: number;
  soldCount?: number;
  status?: ProductStatus;
  imageUrl?: string;
  location?: string;
  description?: string;
  rating?: number;
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

  version?: number;
  createdAt?: string;
  updatedAt?: string;
  searchField?: "name" | "brand";
  searchName?: string;
  inventoryAlertSent?: boolean;
  inventoryAlertSentAt?: string;
};
