export interface ConfirmationMail {
    toEmail: string;
    orderId: string;
    totalAmount: number;
    createdAt: string;
    paymentConfirmedAt?: string;
    items: Array<{
        productName: string;
        quantity: number;
        unitPrice: number;
        originalUnitPrice?: number;
        lineTotal: number;
    }>;
}
export type EmailJob = {
    type: "email.account_welcome.requested";
    emailJobId: string;
    userSub: string;
    toEmail: string;
    displayName?: string;
} | (ConfirmationMail & {
    type: "email.order_confirmation.requested";
    emailJobId: string;
    campaignId: string;
    batchIndex: 0;
    batchCount: 1;
}) | {
    type: "email.sale_campaign.requested";
    emailJobId: string;
    campaignId: string;
    batchIndex: number;
    batchCount: number;
    senderEmail: string;
    recipients: string[];
    subject: string;
    html: string;
    text: string;
};
