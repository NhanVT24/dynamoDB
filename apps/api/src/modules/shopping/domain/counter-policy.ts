export type ProductCounterField = "stock" | "soldCount";

/** Preserve the existing clamp-to-zero behavior, without silently losing precision. */
export function incrementCounter(current: number, incrementBy: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(incrementBy)) {
    throw new RangeError("Product counters require safe integers");
  }
  const next = current + incrementBy;
  if (!Number.isSafeInteger(next)) throw new RangeError("Product counter overflow");
  return Math.max(0, next);
}
