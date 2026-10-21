import { listShoppingItems, listAllShoppingItems, getShoppingItemsPageCursor, getShoppingItem } from "../../shopping.repository.js";
import { normalizeCategory } from "../../shopping.schema.js";
import type { ManagedProductQuery } from "../../application/managed-products.js";
function filters(query: ManagedProductQuery) { return { ...query, category: normalizeCategory(query.category) as string | undefined }; }
export const managedProductReads = {
    list: (query: ManagedProductQuery) => listShoppingItems(query.limit, query.cursor, filters(query)),
    all: (query: ManagedProductQuery) => listAllShoppingItems(query.pageLimit, query.maxPages, filters(query)),
    cursor: (query: ManagedProductQuery) => getShoppingItemsPageCursor(query.page, query.limit, filters(query)),
    find: getShoppingItem,
    async ownedCandidates() {
        const page = await listAllShoppingItems(100, 20, { sortBy: "updatedAt", sortDirection: "desc" });
        return page.items.map(item => ({ ownerId: String(item.ownerSub ?? ""), item }));
    }
};
