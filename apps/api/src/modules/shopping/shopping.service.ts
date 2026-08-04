import { Injectable } from "@nestjs/common";
import {
  createShoppingItem,
  deleteShoppingItem,
  getCursorForPage,
  getMockShoppingItem,
  getShoppingItem,
  getShoppingItemAll,
  incrementItemValue,
  listMockShoppingItems,
  listShoppingItems,
  updateShoppingItem
} from "./shopping.repository.js";
import {
  normalizeCategory,
  shoppingCategories,
  shoppingStatuses
} from "./shopping.schema.js";

@Injectable()
export class ShoppingService {
  listMockItems() {
    return listMockShoppingItems();
  }

  getMockItem(id: string) {
    return getMockShoppingItem(id);
  }

  getMeta() {
    return {
      categories: shoppingCategories,
      statuses: shoppingStatuses,
      searchFields: ["name", "brand"]
    };
  }

  list(query: Record<string, any>) {
    return listShoppingItems(query.limit, query.cursor, {
      category: normalizeCategory(query.category) as string | undefined,
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  }

  listAll(query: Record<string, any>) {
    return getShoppingItemAll(query.pageLimit, query.maxPages, {
      category: normalizeCategory(query.category) as string | undefined,
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  }

  getPageCursor(query: Record<string, any>) {
    return getCursorForPage(query.page, query.limit, {
      category: normalizeCategory(query.category) as string | undefined,
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  }

  getById(id: string) {
    return getShoppingItem(id);
  }

  create(input: Record<string, any>) {
    return createShoppingItem(input);
  }

  update(id: string, patch: Record<string, any>, version: number) {
    return updateShoppingItem(id, patch, version);
  }

  increment(id: string, field: string, incrementBy: number) {
    return incrementItemValue(id, field, incrementBy);
  }

  remove(id: string) {
    return deleteShoppingItem(id);
  }
}
