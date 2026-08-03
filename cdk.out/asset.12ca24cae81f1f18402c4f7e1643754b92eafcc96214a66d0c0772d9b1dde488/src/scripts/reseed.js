import { deleteShoppingItem, getShoppingItemAll } from "../modules/shopping/shopping.repository.js";
console.log("Loading existing products...");
const { items } = await getShoppingItemAll(100, 20);
for (const item of items) {
    await deleteShoppingItem(item.id);
}
console.log(`Deleted ${items.length} existing products.`);
console.log("Seeding fresh products...");
await import("./seed.js");
