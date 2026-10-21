import { randomUUID } from "node:crypto";
import { SalesService } from "./sales.service.js";
import { campaignStore, campaignProducts, AwsCampaignSchedules } from "./infrastructure/campaign-adapters.js";
export function createSalesService() {
    return new SalesService(campaignStore, campaignProducts, new AwsCampaignSchedules(), randomUUID);
}
