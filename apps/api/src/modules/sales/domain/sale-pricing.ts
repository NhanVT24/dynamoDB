import { SalePricing } from "./sale-price.js";
/** Pricing policy accepts business data, never a DynamoDB campaign record. */
export interface PricingCampaign {
  id: string;
  discountPercent: number;
  productIds: string[];
  endAt: string;
}

export type SalePrice = {
  price: number;
  originalPrice: number;
  saleCampaignId?: string;
  saleDiscountPercent?: number;
  saleEndsAt?: string;
};

export function resolveSalePrice(product: { id?: unknown; price?: unknown; originalPrice?: unknown }, campaigns: readonly PricingCampaign[]): SalePrice {
 return new SalePricing(product, campaigns).resolve();
}
