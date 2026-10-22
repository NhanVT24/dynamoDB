import { Product } from "./product.js";
export type { ProductCounterField } from "./product.js";

/** Preserve the existing clamp-to-zero behavior, without silently losing precision. */
export function incrementCounter(current: number, incrementBy: number): number {
  return Product.counterAfterAdjustment(current, incrementBy);
}
