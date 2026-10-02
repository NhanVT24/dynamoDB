import { messages } from "./messages";
import { sourceAliases } from "./source-aliases";

export type Language = "en" | "vi";
export type MessageKey = keyof typeof messages;
export type MessageValues = Readonly<Record<string, string | number>>;
export const languageStorageKey = "novax-language";
const listeners = new Set<() => void>();
let language: Language = "en";

export function getLanguage(): Language { return language; }
export function getIntlLocale(): "en-US" | "vi-VN" { return language === "vi" ? "vi-VN" : "en-US"; }
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setLanguage(next: Language): void {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(languageStorageKey, next); } catch { /* Session-only selection when storage is unavailable. */ }
    document.documentElement.lang = next;
  }
  if (next === language) return;
  language = next;
  listeners.forEach((listener) => listener());
}
export function restoreLanguage(): void {
  if (typeof window === "undefined") return;
  try { setLanguage(window.localStorage.getItem(languageStorageKey) === "vi" ? "vi" : "en"); }
  catch { setLanguage("en"); }
}
export function t(key: MessageKey, values: MessageValues = {}): string {
  const template: string = language === "vi" ? messages[key] : key;
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => String(values[name] ?? match));
}

const aliases: Readonly<Record<string, MessageKey>> = {
  "Thoi trang": "Fashion", "Thời trang": "Fashion", "Dien tu": "Electronics", "Điện tử": "Electronics",
  "Gia dung": "Home Appliances", "Gia dụng": "Home Appliances", "Me va be": "Parenting", "Mẹ và bé": "Parenting",
  "Lam dep": "Beauty", "Làm đẹp": "Beauty", "Bach hoa": "Convenience", "Bách hóa": "Convenience",
  active: "Active", low_stock: "Low stock", out_of_stock: "Out of stock", awaiting_payment: "Awaiting payment",
  paid: "Paid", pending: "Pending", done: "Completed", completed: "Completed", cancelled: "Cancelled", expired: "Expired",
  payment_failed: "Payment failed", refund_pending: "Refund pending", refund_sent: "Refund sent", refund_rejected: "Refund rejected",
  scheduled: "Scheduled", ended: "Ended", sent: "Sent", read: "Read", failed: "Failed", accepted: "Accepted",
  delivered: "Delivered", bounced: "Bounced", complained: "Complained", rejected: "Rejected", delivery_delayed: "Delivery delayed",
  not_sent: "Not sent", unknown: "Unknown", partial_sent: "Partially sent", started: "Started", blocked: "Blocked",
  admin: "Admin", customer: "Customer", viewer: "Viewer", ACTIVE: "Active", SUSPENDED: "Suspended", DISABLED: "Disabled", BLOCKED: "Blocked",
  CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted",
  name: "Name", brand: "Brand", displayName: "Display name", avatarKey: "Avatar", permissions: "Permissions",
  status: "Status", addresses: "Addresses",
  newest: "Newest", oldest: "Oldest", "price-asc": "Price: Low to High", "price-desc": "Price: High to Low", "best-seller": "Best sellers",
  ward: "Ward", city: "City", province: "Province", CONFIRMED: "Confirmed",
  PUBLISHING: "Publishing", PUBLISH_RETRY: "Publish retry", PUBLISH_FAILED: "Publish failed", PUBLISHED: "Published",
  PUBLISH_UNKNOWN: "Publish unknown", RULE_MATCHED: "Rule matched", PROCESSING: "Processing", ROUTING_SUSPECTED: "Routing suspected",
  inventory_daily_report: "Inventory daily report", order_confirmation: "Order confirmation", payment_failure: "Payment failure",
  order_failure: "Order failure", refund_status: "Refund status", sale_campaign: "Sale campaign", account_welcome: "Account welcome"
};
const reverse = new Map<string, MessageKey>(Object.entries(messages).map(([key, value]) => [value, key as MessageKey]));

function compileTemplate(template: string) {
  const names: string[] = [];
  let pattern = "^";
  let position = 0;
  for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
    pattern += template.slice(position, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([\\s\\S]*?)";
    names.push(match[1]!);
    position = match.index! + match[0].length;
  }
  pattern += template.slice(position).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
  return { pattern: new RegExp(pattern), names };
}
const templateMatchers = Object.entries(messages).flatMap(([key, translated]) => {
  if (!/\{[A-Za-z]/.test(key)) return [];
  return [key, translated].map((template) => ({ key: key as MessageKey, ...compileTemplate(template) }));
});

// Use only for UI labels and messages. Product names, identifiers, audit values
// and user-entered content must be rendered directly.
export function translateLabel(value: string | null | undefined): string {
  if (!value) return value ?? "";
  if (/^Missing NEXT_PUBLIC_[A-Z_]+ in apps\/web\/\.env\.local$/.test(value)) {
    return t("Authentication is temporarily unavailable. Please contact support.");
  }
  if (value.startsWith("Cognito request failed:")) return t("The authentication request failed. Please try again.");
  const normalized = Object.hasOwn(sourceAliases, value) ? sourceAliases[value as keyof typeof sourceAliases] : value;
  const key = Object.hasOwn(aliases, normalized) ? aliases[normalized]
    : Object.hasOwn(messages, normalized) ? normalized as MessageKey : reverse.get(normalized);
  if (key) return t(key);
  for (const matcher of templateMatchers) {
    const match = matcher.pattern.exec(normalized);
    if (match) return t(matcher.key, Object.fromEntries(matcher.names.map((name, index) => [name, match[index + 1] ?? ""])));
  }
  return normalized;
}
