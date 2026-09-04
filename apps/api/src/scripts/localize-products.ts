import { listAllShoppingItems, updateShoppingItem } from "../modules/shopping/shopping.repository.js";

const localizedProductsBySku: Record<string, { name: string; location: string; description: string }> = {
  "FW-TS-001": {
    name: "Ao thun the thao nam Dry-Fit",
    location: "TP.HCM",
    description: "Ao thun chat lieu mem, tham hut tot, phu hop ban hang tren san thuong mai dien tu."
  },
  "HP-AF-602": {
    name: "Noi chien khong dau 6L",
    location: "Ha Noi",
    description: "Dung tich lon, phu hop gian hang gia dung va de demo quan ly ton kho."
  },
  "SM-ANC-25": {
    name: "Tai nghe Bluetooth chong on",
    location: "Da Nang",
    description: "San pham dien tu co gia ban, gia goc va rating de hien thi trong trang admin."
  },
  "PS-SR-030": {
    name: "Serum phuc hoi da 30ml",
    location: "Can Tho",
    description: "Mat hang lam dep co thong tin danh gia, luot ban va trang thai ton kho ro rang."
  },
  "BN-DM-048": {
    name: "Ta quan cho be size M",
    location: "Binh Duong",
    description: "San pham het hang de demo trang thai ton kho trong dashboard quan ly."
  },
  "DM-SN-012": {
    name: "Set snack mix 12 goi",
    location: "TP.HCM",
    description: "Mat hang bach hoa co vong quay nhanh, phu hop quan ly ton kho va luot ban."
  }
};

const { items } = await listAllShoppingItems(100, 10);
let updatedCount = 0;

for (const item of items) {
  const patch = localizedProductsBySku[item.sku];
  if (!patch) continue;

  await updateShoppingItem(item.id, patch, item.version);
  updatedCount += 1;
}

console.log(`Localized ${updatedCount} sample products.`);
