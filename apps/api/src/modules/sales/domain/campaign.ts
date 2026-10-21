export type SaleCampaignStatus = "scheduled" | "active" | "ended" | "cancelled";
export interface SaleCampaign {
    id: string;
    name: string;
    campaignStatus: SaleCampaignStatus;
    discountPercent: number;
    productIds: string[];
    startAt: string;
    endAt: string;
    startScheduleName: string;
    endScheduleName: string;
    version: number;
    createdAt: string;
    updatedAt: string;
}
export interface NewSaleCampaign {
    name: string;
    discountPercent: number;
    productIds: string[];
    startAt: string;
    endAt: string;
}
