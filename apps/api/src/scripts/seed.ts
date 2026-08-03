import { createShoppingItem, getShoppingItemAll } from "../modules/shopping/shopping.repository.js";

const categories = ["Thoi trang", "Dien tu", "Gia dung", "Me va be", "Lam dep", "Bach hoa"] as const;
const brands = ["FlexWear", "SoundMax", "HomePro", "BabyNest", "PureSkin", "Daily Mart"] as const;
const locations = ["TP.HCM", "Ha Noi", "Da Nang", "Can Tho", "Binh Duong", "Hai Phong"] as const;
const fashionColors = ["Den", "Trang", "Xanh navy", "Kem"] as const;
const fashionSizes = ["S", "M", "L", "XL"] as const;
const materials = ["Cotton", "Jean", "Da PU", "Polyester"] as const;
const voltages = ["220V", "110V", "5V USB-C"] as const;
const ageRanges = ["0-6 thang", "6-12 thang", "1-3 tuoi", "3-6 tuoi"] as const;
const skinTypes = ["Da dau", "Da kho", "Da hon hop", "Moi loai da"] as const;
const categoryNamePrefixes: Record<string, string> = {
  "Thoi trang": "Ao",
  "Dien tu": "Tai nghe",
  "Gia dung": "Noi",
  "Me va be": "Ta",
  "Lam dep": "Serum",
  "Bach hoa": "Snack"
};

function buildCategorySpecificAttributes(category: string, index: number) {
  if (category === "Thoi trang") {
    return {
      color: fashionColors[index % fashionColors.length],
      size: fashionSizes[index % fashionSizes.length],
      material: materials[index % materials.length]
    };
  }

  if (category === "Dien tu") {
    return {
      warrantyMonths: 12 + (index % 3) * 6,
      voltage: voltages[index % voltages.length],
      weightGrams: 150 + index * 5
    };
  }

  if (category === "Gia dung") {
    return {
      material: materials[index % materials.length],
      capacityLiters: Number((1.5 + (index % 12) * 0.75).toFixed(1))
    };
  }

  if (category === "Me va be") {
    return {
      ageRange: ageRanges[index % ageRanges.length],
      material: materials[index % materials.length]
    };
  }

  if (category === "Lam dep") {
    return {
      skinType: skinTypes[index % skinTypes.length],
      weightGrams: 50 + index * 2,
      expiryDate: `2027-${String((index % 12) + 1).padStart(2, "0")}-15`
    };
  }

  return {
    weightGrams: 200 + index * 3,
    expiryDate: `2027-${String((index % 12) + 1).padStart(2, "0")}-28`
  };
}

const sampleShoppingItems = Array.from({ length: 200 }, (_, index) => {
  const category = categories[index % categories.length];
  const brand = brands[index % brands.length];
  const stock = (index * 7) % 130;
  const price = 50000 + index * 1500;
  const updatedAt = new Date(Date.UTC(2026, 6, 30 - (index % 14), 8, index % 60, 0)).toISOString();

  return {
    name: `${categoryNamePrefixes[category] ?? "San pham"} ${index + 1}`,
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
    featured: index % 8 === 0,
    createdAt: updatedAt,
    updatedAt,
    ...buildCategorySpecificAttributes(category, index)
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
