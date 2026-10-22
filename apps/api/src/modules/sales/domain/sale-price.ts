import type { PricingCampaign, SalePrice } from "./sale-pricing.js";
export class SalePricing {
    readonly #product: {
        id?: unknown;
        price?: unknown;
        originalPrice?: unknown;
    };
    readonly #campaigns: readonly PricingCampaign[];
    constructor(product: {
        id?: unknown;
        price?: unknown;
        originalPrice?: unknown;
    }, campaigns: readonly PricingCampaign[]) {
        this.#product = { ...product };
        this.#campaigns = campaigns.map(campaign => ({ ...campaign, productIds: [...campaign.productIds] }));
    }
    resolve(): SalePrice {
        const product = this.#product, campaigns = this.#campaigns;
        const currentPrice = Number(product.price ?? 0);
        const basePrice = Math.max(currentPrice, Number(product.originalPrice ?? currentPrice));
        const campaign = campaigns.filter(item => item.productIds.includes(String(product.id ?? "")))
            .sort((left, right) => right.discountPercent - left.discountPercent || left.id.localeCompare(right.id))[0];
        if (!campaign)
            return { price: currentPrice, originalPrice: basePrice };
        const campaignPrice = Math.round(basePrice * (100 - campaign.discountPercent) / 100);
        const existingDiscountPercent = basePrice > 0 ? Math.max(0, Math.round((1 - currentPrice / basePrice) * 100)) : 0;
        return { price: Math.min(currentPrice, campaignPrice), originalPrice: basePrice,
            saleCampaignId: campaign.id, saleDiscountPercent: Math.max(existingDiscountPercent, campaign.discountPercent),
            saleEndsAt: campaign.endAt };
    }
}
