import type { SaleCampaign } from "./sales.repository.js";

export type SalePrice = {
  price: number;
  originalPrice: number;
  saleCampaignId?: string;
  saleDiscountPercent?: number;
  saleEndsAt?: string;
};

export function resolveSalePrice(product: Record<string, unknown>, campaigns: SaleCampaign[]): SalePrice {
  const currentPrice = Number(product.price ?? 0);
  const basePrice = Math.max(currentPrice, Number(product.originalPrice ?? currentPrice));
  const productId = String(product.id ?? "");
  const campaign = campaigns
    .filter((item) => item.productIds.includes(productId))
    .sort((left, right) => right.discountPercent - left.discountPercent || left.id.localeCompare(right.id))[0];

  if (!campaign) return { price: currentPrice, originalPrice: basePrice };
  const campaignPrice = Math.round(basePrice * (100 - campaign.discountPercent) / 100);
  const existingDiscountPercent = basePrice > 0
    ? Math.max(0, Math.round((1 - currentPrice / basePrice) * 100))
    : 0;

  // A campaign member stays visible in the sale rail even when its manual price is already lower.
  // The customer always receives the lower price and sees the effective discount percentage.
  return {
    price: Math.min(currentPrice, campaignPrice),
    originalPrice: basePrice,
    saleCampaignId: campaign.id,
    saleDiscountPercent: Math.max(existingDiscountPercent, campaign.discountPercent),
    saleEndsAt: campaign.endAt
  };
}
