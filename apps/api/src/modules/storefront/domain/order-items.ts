import { OrderActionError } from "./order.error.js";
import type { CheckoutItem } from "./checkout.js";
/** Cart value object: normalized lines, not an entity with its own identity. */
export class OrderItems {
    readonly #items: readonly Readonly<CheckoutItem>[];
    constructor(items: readonly CheckoutItem[]) {
        if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
            throw new OrderActionError("INVALID_INPUT", "Checkout requires 1 to 20 items.");
        }
        const merged = new Map<string, number>();
        for (const item of items) {
            const id = String(item?.productId ?? "").trim().replace(/^PRODUCT#/i, "");
            if (!id || !Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > 50) {
                throw new OrderActionError("INVALID_INPUT", "Invalid checkout item.");
            }
            const quantity = (merged.get(id) ?? 0) + item.quantity;
            if (quantity > 50)
                throw new OrderActionError("INVALID_INPUT", "Maximum quantity per product is 50.");
            merged.set(id, quantity);
        }
        this.#items = Object.freeze([...merged].map(([productId, quantity]) => Object.freeze({ productId, quantity })));
    }
    toSnapshot(): CheckoutItem[] { return this.#items.map(item => ({ ...item })); }
}
