function normalizeProductId(id: string) {
  return String(id ?? "").trim().replace(/^PRODUCT#/i, "");
}

export const keys = {
  product(id: string) {
    const normalizedId = normalizeProductId(id);
    return {
      PK: `PRODUCT#${normalizedId}`,
      SK: "DETAIL"
    };
  }
};
