import type { StoreCategory, StoreProduct } from "./store-types";

const itemImageUrl = "https://placehold.co/1200x1200/png?text=Items";

const categoryConfigs = [
  {
    id: "dien-tu",
    label: "Electronics",
    accent: "linear-gradient(90deg, #38bdf8 0%, #22d3ee 50%, #2dd4bf 100%)",
    imageUrl: itemImageUrl,
    description: "Products and gadgets for your tech-savvy lifestyle, from audio to smart home devices."
  },
  {
    id: "gia-dung",
    label: "Home Appliances",
    accent: "linear-gradient(90deg, #fb923c 0%, #fbbf24 50%, #fde047 100%)",
    imageUrl: itemImageUrl,
    description: "Smart products that make your living space more efficient and convenient."
  },
  {
    id: "thoi-trang",
    label: "Fashion",
    accent: "linear-gradient(90deg, #f472b6 0%, #fb7185 50%, #fda4af 100%)",
    imageUrl: itemImageUrl,
    description: "Accessories, backpacks, and wearable tech for the modern lifestyle."
  },
  {
    id: "lam-dep",
    label: "Beauty",
    accent: "linear-gradient(90deg, #a78bfa 0%, #c084fc 50%, #f9a8d4 100%)",
    imageUrl: itemImageUrl,
    description: "Personal care devices and beauty routines for the busy lifestyle."
  },
  {
    id: "me-va-be",
    label: "Parenting",
    accent: "linear-gradient(90deg, #34d399 0%, #a3e635 50%, #4ade80 100%)",
    imageUrl: itemImageUrl,
    description: "Lightweight, safe, and convenient options for modern families."
  },
  {
    id: "bach-hoa",
    label: "Convenience",
    accent: "linear-gradient(90deg, #f87171 0%, #fb923c 50%, #fbbf24 100%)",
    imageUrl: itemImageUrl,
    description: "Quick-buy products, everyday essentials, and items you'll want to repurchase."
  }
] as const;

const brands = ["NovaTech", "Auralix", "Lumio", "NestCore", "Veltra", "Kairo"] as const;
const locations = ["Ho Chi Minh City", "Hanoi", "Da Nang", "Can Tho", "Hai Phong", "Binh Duong"] as const;

const productSeeds = [
  ["Aurora X Pro", "dien-tu", "Flagship noise-cancelling headphones with a wide soundstage, long battery life, and an anodized aluminum design."],
  ["Helix Pad Air", "dien-tu", "A mobile entertainment and productivity tablet with a 144Hz display and AI-optimized chipset."],
  ["Orbit Charge Dock", "dien-tu", "A minimalist multi-device charging dock for a premium desk setup."],
  ["Luma Beam Mini", "gia-dung", "A compact living-room projector with quick casting support and built-in speakers."],
  ["Pulse Brew Station", "gia-dung", "A smart coffee station for a cleaner, more consistent morning routine."],
  ["AeroClean S8", "gia-dung", "A powerful handheld vacuum designed for modern apartments."],
  ["Strata Carry Pack", "thoi-trang", "A water-resistant tech backpack with optimized laptop and accessory compartments."],
  ["Halo Sync Watch", "thoi-trang", "A health-focused smartwatch for sleep tracking, movement, and daily wellness."],
  ["Frame One Glass", "thoi-trang", "Open-ear audio glasses for staying aware while moving through the day."],
  ["SilkPulse Pro", "lam-dep", "A facial care device with multiple modes for everyday skin routines."],
  ["Glow Capsule", "lam-dep", "A serum and mini-steamer kit for a simple but effective evening routine."],
  ["Mist Air Brush", "lam-dep", "A lightweight styling dryer with low noise and a complete accessory set."],
  ["Nest View Cam", "me-va-be", "A family monitoring camera with motion detection and two-way audio."],
  ["Cloud Rest Pod", "me-va-be", "A smart soothing chair with gentle motion and easy-clean materials."],
  ["Mini Warm Cube", "me-va-be", "A compact bottle warmer for kitchens, bedrooms, and small spaces."],
  ["Daily Smart Box", "bach-hoa", "A tech-inspired essentials gift box for office workers and young families."],
  ["Crunch Go Set", "bach-hoa", "A premium snack combo designed for workdays and travel."],
  ["Pure Water Tabs", "bach-hoa", "Portable cleaning tablets for bottles and short trips."],
  ["AeroBook Z14", "dien-tu", "A thin and light laptop for mobile users who need stable everyday performance."],
  ["Echo Studio Mic", "dien-tu", "A USB microphone for streamers, creators, and high-quality online meetings."],
  ["Steam Fold Iron", "gia-dung", "A foldable steam iron optimized for small apartments and busy schedules."],
  ["Motion Fit Ring", "thoi-trang", "A smart health ring with continuous sensors and long battery life."],
  ["Calm Spa Light", "lam-dep", "A bedroom relaxation lamp with gentle light therapy for the end of the day."],
  ["Tiny Meal Keeper", "me-va-be", "A smart food container that helps track reminders and daily snacks."]
] as const;

export const storeCategories: StoreCategory[] = categoryConfigs.map((category) => ({ ...category }));

export const storeProducts: StoreProduct[] = productSeeds.map(([name, categoryId, description], index) => {
  const category = storeCategories.find((item) => item.id === categoryId)!;
  const brand = brands[index % brands.length];
  const basePrice = 890000 + index * 290000;
  const stock = [42, 18, 0, 12, 31, 9][index % 6];
  const originalPrice = basePrice + (180000 + (index % 4) * 120000);
  const updatedAt = new Date(Date.UTC(2026, 7, 6 - (index % 10), 3 + (index % 8), 0, 0)).toISOString();

  return {
    id: `store-product-${index + 1}`,
    slug: `${name}-${brand}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    name,
    category: category.label,
    brand,
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    stock,
    price: basePrice,
    originalPrice,
    status: stock === 0 ? "out_of_stock" : stock <= 12 ? "low_stock" : "active",
    rating: Number((4.4 + (index % 5) * 0.1).toFixed(1)),
    soldCount: 140 + index * 17,
    featured: index % 3 === 0,
    description,
    imageUrl: category.imageUrl,
    location: locations[index % locations.length],
    updatedAt,
    badge: index % 5 === 0 ? "New arrival" : index % 4 === 0 ? "Best seller" : undefined,
    specs: [
      `${brand} Edition`,
      `${index % 2 === 0 ? "12-month warranty" : "24-month warranty"}`,
      `${index % 3 === 0 ? "2-hour express delivery" : "7-day returns"}`
    ]
  };
});

export const featuredProducts = storeProducts.filter((item) => item.featured).slice(0, 8);
export const bestSellerProducts = [...storeProducts].sort((a, b) => b.soldCount - a.soldCount).slice(0, 8);
export const flashSaleProducts = [...storeProducts]
  .sort((a, b) => (b.originalPrice - b.price) - (a.originalPrice - a.price))
  .slice(0, 4);
export const newArrivals = [...storeProducts]
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  .slice(0, 8);

export function findProductBySlug(slug: string) {
  return storeProducts.find((item) => item.slug === slug) ?? null;
}

export function findProductById(id: string) {
  return storeProducts.find((item) => item.id === id) ?? null;
}

export function getRelatedProducts(product: StoreProduct) {
  return storeProducts.filter((item) => item.id !== product.id && item.category === product.category).slice(0, 4);
}
