import { createShoppingItem, getShoppingItemAll } from "../modules/shopping/shopping.repository.js";

const sampleShoppingItems = [
  {
    name: "Áo thun thể thao nam Dry-Fit",
    category: "Thoi trang",
    brand: "FlexWear",
    sku: "FW-TS-001",
    stock: 124,
    price: 189000,
    originalPrice: 259000,
    imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    location: "TP.HCM",
    description: "Áo thun chất liệu mềm, thấm hút tốt, phù hợp bán hàng trên sàn thương mại điện tử.",
    rating: 4.9,
    soldCount: 1240,
    featured: true
  },
  {
    name: "Nồi chiên không dầu 6L",
    category: "Gia dung",
    brand: "HomePro",
    sku: "HP-AF-602",
    stock: 18,
    price: 1290000,
    originalPrice: 1690000,
    imageUrl: "https://images.unsplash.com/photo-1585515656973-2b7c1e967d5d?auto=format&fit=crop&w=900&q=80",
    location: "Hà Nội",
    description: "Dung tích lớn, phù hợp gian hàng gia dụng và dễ demo quản lý tồn kho.",
    rating: 4.8,
    soldCount: 386,
    featured: true
  },
  {
    name: "Tai nghe Bluetooth chống ồn",
    category: "Dien tu",
    brand: "SoundMax",
    sku: "SM-ANC-25",
    stock: 7,
    price: 890000,
    originalPrice: 1190000,
    imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80",
    location: "Đà Nẵng",
    description: "Sản phẩm điện tử có giá bán, giá gốc và rating để hiển thị trong trang admin.",
    rating: 4.7,
    soldCount: 942,
    featured: true
  },
  {
    name: "Serum phục hồi da 30ml",
    category: "Lam dep",
    brand: "PureSkin",
    sku: "PS-SR-030",
    stock: 52,
    price: 315000,
    originalPrice: 450000,
    imageUrl: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=80",
    location: "Cần Thơ",
    description: "Mặt hàng làm đẹp có thông tin đánh giá, lượt bán và trạng thái tồn kho rõ ràng.",
    rating: 4.9,
    soldCount: 2100,
    featured: false
  },
  {
    name: "Tã quần cho bé size M",
    category: "Me va be",
    brand: "BabyNest",
    sku: "BN-DM-048",
    stock: 0,
    price: 279000,
    originalPrice: 329000,
    imageUrl: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80",
    location: "Bình Dương",
    description: "Sản phẩm hết hàng để demo trạng thái tồn kho trong dashboard quản lý.",
    rating: 4.6,
    soldCount: 560,
    featured: false
  },
  {
    name: "Set snack mix 12 gói",
    category: "Bach hoa",
    brand: "Daily Mart",
    sku: "DM-SN-012",
    stock: 76,
    price: 99000,
    originalPrice: 129000,
    imageUrl: "https://images.unsplash.com/photo-1579613832125-5d34a13ffe2a?auto=format&fit=crop&w=900&q=80",
    location: "TP.HCM",
    description: "Mặt hàng bách hóa có vòng quay nhanh, phù hợp quản lý tồn kho và lượt bán.",
    rating: 4.8,
    soldCount: 1480,
    featured: true
  }
];

const existing = await getShoppingItemAll(1, 1);

if ((existing.items ?? []).length > 0) {
  console.log("Products already exist. Skip seeding.");
  process.exit(0);
}

for (const item of sampleShoppingItems) {
  await createShoppingItem(item);
}

console.log("Seeded sample products.");
