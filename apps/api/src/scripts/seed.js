import { createShoppingItem, getShoppingItemAll } from "../modules/shopping/shopping.repository.js";

const categories = ["Thoi trang", "Dien tu", "Gia dung", "Me va be", "Lam dep", "Bach hoa"];
const brands = ["FlexWear", "SoundMax", "HomePro", "BabyNest", "PureSkin", "Daily Mart"];
const locations = ["TP.HCM", "Ha Noi", "Da Nang", "Can Tho", "Binh Duong", "Hai Phong"];

const sampleShoppingItems = Array.from({ length: 200 }, (_, index) => {
  const category = categories[index % categories.length];
  const brand = brands[index % brands.length];
  const stock = (index * 7) % 130;
  const price = 50000 + index * 1500;

  return {
    name: `San pham ${index + 1}`,
    category,
    brand,
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    stock,
    price,
    originalPrice: price + 20000,
    imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    location: locations[index % locations.length],
    description: `Mo ta ngan cho san pham ${index + 1} thuoc danh muc ${category}.`,
    rating: Number((4 + ((index % 10) / 10)).toFixed(1)),
    soldCount: 100 + index * 9,
    featured: index % 8 === 0
  };
});

const existing = await getShoppingItemAll(1, 1);

if ((existing.items ?? []).length > 0) {
  console.log("Products already exist. Skip seeding.");
  process.exit(0);
}

for (const item of sampleShoppingItems) {
  await createShoppingItem(item);
}

console.log(`Seeded ${sampleShoppingItems.length} sample products.`);
