import type { CartItem } from "../types/store";

export function calculateSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function calculateShipping(items: CartItem[]) {
  if (items.length === 0) return 0;
  const subtotal = calculateSubtotal(items);
  return subtotal >= 3000000 ? 0 : 45000;
}

export function calculateDiscount(code: string, subtotal: number) {
  if (code.trim().toUpperCase() === "NOVA500") {
    return Math.min(500000, Math.round(subtotal * 0.08));
  }
  return 0;
}
