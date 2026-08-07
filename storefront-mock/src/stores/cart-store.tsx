import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CartItem, StoreProduct } from "../types/store";
import { calculateDiscount, calculateShipping, calculateSubtotal } from "../utils/cart";

type CartContextValue = {
  items: CartItem[];
  isDrawerOpen: boolean;
  discountCode: string;
  addCatalogItem: (product: StoreProduct, quantity: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  toggleDrawer: (open?: boolean) => void;
  setDiscountCode: (value: string) => void;
  clearCart: () => void;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  count: number;
};

const storageKey = "premium-storefront-cart";
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { items?: CartItem[]; discountCode?: string };
      setItems(parsed.items ?? []);
      setDiscountCode(parsed.discountCode ?? "");
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ items, discountCode }));
  }, [discountCode, items]);

  function addCatalogItem(product: StoreProduct, quantity: number) {
    setItems((current) => {
      const existing = current.find((item) => item.variantId === product.id);
      if (existing) {
        return current.map((item) =>
          item.variantId === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, item.stock) }
            : item
        );
      }

      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          variantId: product.id,
          variantName: product.brand,
          sku: product.sku,
          price: product.price,
          quantity,
          stock: product.stock,
          image: product.imageUrl
        }
      ];
    });
    setIsDrawerOpen(true);
  }

  function updateQuantity(variantId: string, quantity: number) {
    setItems((current) =>
      current.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.max(1, Math.min(quantity, item.stock)) }
          : item
      )
    );
  }

  function removeItem(variantId: string) {
    setItems((current) => current.filter((item) => item.variantId !== variantId));
  }

  function toggleDrawer(open?: boolean) {
    setIsDrawerOpen((current) => (typeof open === "boolean" ? open : !current));
  }

  function clearCart() {
    setItems([]);
    setDiscountCode("");
  }

  const subtotal = useMemo(() => calculateSubtotal(items), [items]);
  const shipping = useMemo(() => calculateShipping(items), [items]);
  const discount = useMemo(() => calculateDiscount(discountCode, subtotal), [discountCode, subtotal]);
  const total = subtotal + shipping - discount;
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isDrawerOpen,
        discountCode,
        addCatalogItem,
        updateQuantity,
        removeItem,
        toggleDrawer,
        setDiscountCode,
        clearCart,
        subtotal,
        shipping,
        discount,
        total,
        count
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
