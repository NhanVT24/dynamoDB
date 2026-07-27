import { createShoppingItem } from "../modules/shopping/shopping.repository.js";

const sampleShoppingItems = [
  { name: "Gạo ST25", category: "Thực phẩm", quantity: 1, unitPrice: 185000, priceLabel: "185.000đ / túi", purchased: false },
  { name: "Sữa tươi", category: "Đồ uống", quantity: 2, unitPrice: 34000, priceLabel: "34.000đ / hộp", purchased: true },
  { name: "Nước rửa chén", category: "Đồ gia dụng", quantity: 1, unitPrice: 42000, priceLabel: "42.000đ / chai", purchased: false },
  { name: "Bàn chải đánh răng", category: "Chăm sóc cá nhân", quantity: 3, unitPrice: 18000, priceLabel: "18.000đ / cái", purchased: false }
];

for (const item of sampleShoppingItems) {
  await createShoppingItem(item);
}

console.log("Seeded sample shopping items.");
