import { getIntlLocale } from "../../src/i18n/language";
import type { CartItem } from "./store-types";

export function formatCurrency(value: number) {
  return new Intl.NumberFormat(getIntlLocale(), {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function calculateSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function calculateShipping(items: CartItem[]) {
  if (items.length === 0) return 0;
  const subtotal = calculateSubtotal(items);
  return subtotal >= 3000000 ? 0 : 45000;
}

export function calculateCartQuantity(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
