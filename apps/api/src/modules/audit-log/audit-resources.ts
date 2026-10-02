export const auditResourceTypes = [
  "ORDER", "PAYMENT", "USER", "PRODUCT", "SALE_CAMPAIGN", "NOTIFICATION", "CHECKOUT", "EMAIL", "EMAIL_ROUTE", "OPERATION"
] as const;
export type AuditResourceType = typeof auditResourceTypes[number];

export const auditFieldWhitelist = {
  ORDER: ["status", "totalAmount", "refundStatus", "refundRequestId", "paymentConfirmedAt"],
  PAYMENT: ["status", "amount", "responseCode", "gatewayTransactionStatus", "bankCode", "paidAt"],
  USER: {
    PROFILE: ["displayName", "avatarKey", "status", "addresses", "passwordResetAt"],
    AUTHORIZATION: ["permissions"]
  },
  PRODUCT: ["name", "category", "brand", "sku", "stock", "price", "originalPrice", "imageUrl", "location", "description", "rating", "soldCount", "featured", "status", "color", "size", "material", "warrantyMonths", "voltage", "capacityLiters", "ageRange", "skinType", "weightGrams", "expiryDate"],
  SALE_CAMPAIGN: ["name", "campaignStatus", "discountPercent", "productIds", "startAt", "endAt"],
  NOTIFICATION: ["channel", "status", "isRead"],
  CHECKOUT: ["status", "quantity", "unitPrice", "originalUnitPrice", "failureCode", "orderId", "lockedUntil"],
  EMAIL: ["emailType", "recipientCount", "sendStatus", "status", "recipientType", "statusAt", "relatedId", "reportId"],
  EMAIL_ROUTE: ["status", "routeStage", "alertStatus", "publishAttempts", "manualRetryCount", "nextPublishAt"],
  OPERATION: ["status", "method", "route", "targetId", "httpStatus"]
} as const;

export function auditTarget(pk: string, sk: string): { resourceType: AuditResourceType; resourceId: string; fields: readonly string[] } | null {
  if (pk.startsWith("USER#") && (sk === "PROFILE" || sk === "AUTHORIZATION")) {
    return { resourceType: "USER", resourceId: pk.slice(5), fields: auditFieldWhitelist.USER[sk] };
  }
  const targets: Array<[string, AuditResourceType, boolean]> = [
    ["ORDER#", "ORDER", sk === "ORDER" || sk === "DETAIL"],
    ["PAYMENT#", "PAYMENT", sk === "DETAIL"],
    ["PRODUCT#", "PRODUCT", sk === "DETAIL"],
    ["SALE_CAMPAIGN#", "SALE_CAMPAIGN", sk === "DETAIL"],
    ["NOTIFICATION#", "NOTIFICATION", sk === "DETAIL"],
    ["CHECKOUT_GATE#", "CHECKOUT", sk === "DETAIL"],
    ["CHECKOUT_RESERVATION#", "CHECKOUT", sk.startsWith("PRODUCT#")],
    ["EMAIL#", "EMAIL", sk === "META" || sk === "DETAIL" || sk.startsWith("RECIPIENT#")],
    ["EMAIL_ROUTE#", "EMAIL_ROUTE", sk === "STATUS"],
    ["OPERATION#", "OPERATION", sk === "DETAIL"]
  ];
  for (const [prefix, resourceType, matches] of targets) {
    if (matches && pk.startsWith(prefix)) {
      const id = pk.slice(prefix.length);
      const resourceId = pk.startsWith("CHECKOUT_RESERVATION#") || (resourceType === "EMAIL" && sk.startsWith("RECIPIENT#")) ? `${id}/${sk}` : id;
      return { resourceType, resourceId, fields: auditFieldWhitelist[resourceType as Exclude<AuditResourceType, "USER">] };
    }
  }
  return null;
}
