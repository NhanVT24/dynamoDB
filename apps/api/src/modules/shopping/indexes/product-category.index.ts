export type ProductCategoryIndexProduct = Record<string, any>;

export type ProductCategoryIndexRecord = {
  PK: string;
  SK: string;
  entityType: "PRODUCT_CATEGORY_INDEX";
  productId: string;
  categoryKey: string;
  product: ProductCategoryIndexProduct;
  updatedAt: string;
};

export function normalizeProductCategoryIndexText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Ä‘Ä]/g, "d")
    .replace(/Ã„â€˜/g, "d");
}

export function buildProductCategoryIndexKey(category: unknown, productId: unknown, updatedAt: unknown) {
  const categoryKey = normalizeProductCategoryIndexText(category);
  const normalizedProductId = String(productId ?? "").trim().replace(/^PRODUCT#/i, "");
  const updatedAtValue = String(updatedAt ?? "");

  return {
    PK: `PRODUCT_CATEGORY#${categoryKey || "uncategorized"}`,
    SK: `UPDATED#${updatedAtValue}#PRODUCT#${normalizedProductId}`
  };
}

export function buildProductCategoryIndexPartitionKey(category: unknown) {
  return buildProductCategoryIndexKey(category, "", "").PK;
}

export function toProductCategoryIndexRecord(product: ProductCategoryIndexProduct): ProductCategoryIndexRecord {
  const key = buildProductCategoryIndexKey(product.category, product.id, product.updatedAt ?? product.createdAt);

  return {
    ...key,
    entityType: "PRODUCT_CATEGORY_INDEX",
    productId: String(product.id ?? ""),
    categoryKey: normalizeProductCategoryIndexText(product.category),
    product,
    updatedAt: String(product.updatedAt ?? product.createdAt ?? "")
  };
}

export function isProductCategoryIndexRecord(item: Record<string, any> | null): item is ProductCategoryIndexRecord {
  return item?.entityType === "PRODUCT_CATEGORY_INDEX" && Boolean((item as ProductCategoryIndexRecord).product);
}
