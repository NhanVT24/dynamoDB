import { getShoppingItemAll, updateShoppingItem } from "../modules/shopping/shopping.repository.js";

const localizedProductsBySku = {
  "FW-TS-001": {
    name: "Áo thun thể thao nam Dry-Fit",
    location: "TP.HCM",
    description: "Áo thun chất liệu mềm, thấm hút tốt, phù hợp bán hàng trên sàn thương mại điện tử."
  },
  "HP-AF-602": {
    name: "Nồi chiên không dầu 6L",
    location: "Hà Nội",
    description: "Dung tích lớn, phù hợp gian hàng gia dụng và dễ demo quản lý tồn kho."
  },
  "SM-ANC-25": {
    name: "Tai nghe Bluetooth chống ồn",
    location: "Đà Nẵng",
    description: "Sản phẩm điện tử có giá bán, giá gốc và rating để hiển thị trong trang admin."
  },
  "PS-SR-030": {
    name: "Serum phục hồi da 30ml",
    location: "Cần Thơ",
    description: "Mặt hàng làm đẹp có thông tin đánh giá, lượt bán và trạng thái tồn kho rõ ràng."
  },
  "BN-DM-048": {
    name: "Tã quần cho bé size M",
    location: "Bình Dương",
    description: "Sản phẩm hết hàng để demo trạng thái tồn kho trong dashboard quản lý."
  },
  "DM-SN-012": {
    name: "Set snack mix 12 gói",
    location: "TP.HCM",
    description: "Mặt hàng bách hóa có vòng quay nhanh, phù hợp quản lý tồn kho và lượt bán."
  }
};

const { items } = await getShoppingItemAll(100, 10);
let updatedCount = 0;

for (const item of items) {
  const patch = localizedProductsBySku[item.sku];
  if (!patch) continue;

  await updateShoppingItem(item.id, patch, item.version);
  updatedCount += 1;
}

console.log(`Localized ${updatedCount} sample products.`);
