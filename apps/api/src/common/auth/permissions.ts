export const productPermissions = [
  "products:create",
  "products:update-own",
  "products:delete-own"
] as const;

export type ProductPermission = (typeof productPermissions)[number];

const supportedPermissions = new Set<string>(productPermissions);

export function isProductPermission(value: unknown): value is ProductPermission {
  return typeof value === "string" && supportedPermissions.has(value);
}

export function normalizePermissions(value: unknown): ProductPermission[] {
  const entries = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

  return [...new Set(entries.map((entry) => String(entry).trim()).filter(isProductPermission))];
}

