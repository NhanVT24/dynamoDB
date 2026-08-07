import type { StoreCategory, StoreProduct } from "../types/store";

const categoryConfigs = [
  {
    id: "dien-tu",
    label: "Điện tử",
    accent: "from-sky-400 via-cyan-300 to-teal-200",
    imageUrl:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80",
    description: "Thiết bị công nghệ, phụ kiện flagship và gear cá nhân cho nhịp sống hiện đại."
  },
  {
    id: "gia-dung",
    label: "Gia dụng",
    accent: "from-orange-400 via-amber-300 to-yellow-200",
    imageUrl:
      "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80",
    description: "Những món đồ thông minh giúp không gian sống gọn, đẹp và hiệu quả hơn."
  },
  {
    id: "thoi-trang",
    label: "Thời trang",
    accent: "from-fuchsia-400 via-pink-300 to-rose-200",
    imageUrl:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80",
    description: "Phụ kiện, balo và đồ wearable đậm chất lifestyle công nghệ cao cấp."
  },
  {
    id: "lam-dep",
    label: "Làm đẹp",
    accent: "from-violet-400 via-purple-300 to-pink-200",
    imageUrl:
      "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80",
    description: "Thiết bị chăm sóc cá nhân và routine beauty dành cho người bận rộn."
  },
  {
    id: "me-va-be",
    label: "Mẹ và bé",
    accent: "from-emerald-400 via-lime-300 to-green-200",
    imageUrl:
      "https://images.unsplash.com/photo-1515488764276-beab7607c1e6?auto=format&fit=crop&w=1200&q=80",
    description: "Các lựa chọn gọn nhẹ, an toàn và tiện lợi cho gia đình trẻ."
  },
  {
    id: "bach-hoa",
    label: "Bách hóa",
    accent: "from-red-400 via-orange-300 to-amber-200",
    imageUrl:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80",
    description: "Nhóm sản phẩm mua nhanh, tiêu dùng thường xuyên và dễ quay lại."
  }
] as const;

const brands = ["NovaTech", "Auralix", "Lumio", "NestCore", "Veltra", "Kairo"] as const;
const locations = ["TP.HCM", "Hà Nội", "Đà Nẵng", "Cần Thơ", "Hải Phòng", "Bình Dương"] as const;

const productSeeds = [
  ["Aurora X Pro", "dien-tu", "Tai nghe chống ồn flagship với âm trường rộng, pin bền và thiết kế nhôm anodized."],
  ["Helix Pad Air", "dien-tu", "Tablet giải trí và làm việc di động với màn hình 144Hz và chip tối ưu AI."],
  ["Orbit Charge Dock", "dien-tu", "Dock sạc đa thiết bị theo phong cách tối giản cho bàn làm việc premium."],
  ["Luma Beam Mini", "gia-dung", "Máy chiếu gọn nhẹ cho phòng khách, hỗ trợ chiếu nhanh và loa tích hợp."],
  ["Pulse Brew Station", "gia-dung", "Máy pha cà phê thông minh cho routine buổi sáng chỉn chu hơn."],
  ["AeroClean S8", "gia-dung", "Máy hút bụi cầm tay động cơ mạnh, phù hợp căn hộ thành thị."],
  ["Strata Carry Pack", "thoi-trang", "Balo công nghệ chống nước với ngăn laptop và phụ kiện rời tối ưu."],
  ["Halo Sync Watch", "thoi-trang", "Đồng hồ thông minh thiên về sức khỏe, tracking ngủ và vận động."],
  ["Frame One Glass", "thoi-trang", "Kính âm thanh mở cho người thích vừa di chuyển vừa giữ nhận biết môi trường."],
  ["SilkPulse Pro", "lam-dep", "Máy chăm sóc da mặt với nhiều chế độ tinh chỉnh theo nhu cầu hằng ngày."],
  ["Glow Capsule", "lam-dep", "Bộ serum và máy xông mini dành cho routine tối đơn giản nhưng hiệu quả."],
  ["Mist Air Brush", "lam-dep", "Máy sấy tạo kiểu thân nhẹ, tiếng ồn thấp và phụ kiện đầy đủ."],
  ["Nest View Cam", "me-va-be", "Camera giám sát gia đình với cảm biến chuyển động và âm thanh hai chiều."],
  ["Cloud Rest Pod", "me-va-be", "Ghế rung thông minh với nhịp mô phỏng nhẹ và chất liệu dễ vệ sinh."],
  ["Mini Warm Cube", "me-va-be", "Máy hâm sữa nhỏ gọn phù hợp không gian bếp hoặc phòng ngủ."],
  ["Daily Smart Box", "bach-hoa", "Hộp quà tiêu dùng công nghệ hóa cho dân văn phòng và gia đình trẻ."],
  ["Crunch Go Set", "bach-hoa", "Combo snack cao cấp tiện mang theo khi làm việc hoặc di chuyển."],
  ["Pure Water Tabs", "bach-hoa", "Viên lọc và làm sạch tiện dụng cho bình cá nhân và các chuyến đi ngắn."],
  ["AeroBook Z14", "dien-tu", "Laptop mỏng nhẹ cho nhóm người dùng cần tính cơ động và hiệu suất ổn định."],
  ["Echo Studio Mic", "dien-tu", "Micro USB cho streamer, creator và các buổi họp online chất lượng cao."],
  ["Steam Fold Iron", "gia-dung", "Bàn ủi hơi nước gập gọn, tối ưu cho căn hộ nhỏ và lịch trình bận rộn."],
  ["Motion Fit Ring", "thoi-trang", "Nhẫn thông minh theo dõi sức khỏe với cảm biến liên tục và thời lượng pin dài."],
  ["Calm Spa Light", "lam-dep", "Đèn thư giãn phòng ngủ kết hợp liệu pháp ánh sáng nhẹ cuối ngày."],
  ["Tiny Meal Keeper", "me-va-be", "Hộp bảo quản thông minh giúp nhắc giờ và quản lý bữa phụ trong ngày."]
] as const;

export const storeCategories: StoreCategory[] = categoryConfigs.map((category) => ({
  ...category
}));

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
    badge: index % 5 === 0 ? "Mới về" : index % 4 === 0 ? "Bán chạy" : undefined,
    specs: [
      `${brand} Edition`,
      `${index % 2 === 0 ? "Bảo hành 12 tháng" : "Bảo hành 24 tháng"}`,
      `${index % 3 === 0 ? "Giao nhanh 2H" : "Đổi trả 7 ngày"}`
    ]
  };
});

export const featuredProducts = storeProducts.filter((item) => item.featured).slice(0, 8);
export const newArrivals = [...storeProducts]
  .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  .slice(0, 8);
export const flashSaleProducts = [...storeProducts]
  .sort((left, right) => right.originalPrice - right.price - (left.originalPrice - left.price))
  .slice(0, 4);
export const bestSellerProducts = [...storeProducts]
  .sort((left, right) => right.soldCount - left.soldCount)
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
