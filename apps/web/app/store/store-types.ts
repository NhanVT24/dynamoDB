export type StoreCategory = {
  id: string;
  label: string;
  description: string;
  imageUrl: string;
  accent: string;
};

export type StoreProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  brand: string;
  sku: string;
  stock: number;
  price: number;
  originalPrice: number;
  status: "active" | "low_stock" | "out_of_stock";
  rating: number;
  soldCount: number;
  featured: boolean;
  description: string;
  imageUrl: string;
  location: string;
  updatedAt: string;
  badge?: string;
  specs: string[];
};

export type CartItem = {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  sku: string;
  price: number;
  quantity: number;
  stock: number;
  image: string;
};

export type StoreOrderLine = {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  lineTotal: number;
};

export type StoreOrder = {
  id: string;
  customerEmail: string;
  status: string;
  items: StoreOrderLine[];
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
};
