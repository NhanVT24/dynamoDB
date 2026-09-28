export function isCustomerOrderMutation(method: string, url: string): boolean {
  if (method !== "POST") return false;
  return url === "/api/storefront/orders"
    || /^\/api\/storefront\/orders\/[^/]+\/(?:cancel|refund(?:\/status)?)(?:\?|$)/.test(url);
}
