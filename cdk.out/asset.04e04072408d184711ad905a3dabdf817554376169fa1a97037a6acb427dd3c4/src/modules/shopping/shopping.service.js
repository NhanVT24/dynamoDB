var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { createShoppingItem, deleteShoppingItem, getCursorForPage, getMockShoppingItem, getShoppingItem, getShoppingItemAll, incrementItemValue, listMockShoppingItems, listShoppingItems, updateShoppingItem } from "./shopping.repository.js";
import { normalizeCategory, shoppingCategories, shoppingStatuses } from "./shopping.schema.js";
let ShoppingService = class ShoppingService {
    listMockItems() {
        return listMockShoppingItems();
    }
    getMockItem(id) {
        return getMockShoppingItem(id);
    }
    getMeta() {
        return {
            categories: shoppingCategories,
            statuses: shoppingStatuses,
            searchFields: ["name", "brand"]
        };
    }
    list(query) {
        return listShoppingItems(query.limit, query.cursor, {
            category: normalizeCategory(query.category),
            status: query.status,
            updatedAtFrom: query.updatedAtFrom,
            searchField: query.searchField,
            search: query.search,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection
        });
    }
    listAll(query) {
        return getShoppingItemAll(query.pageLimit, query.maxPages, {
            category: normalizeCategory(query.category),
            status: query.status,
            updatedAtFrom: query.updatedAtFrom,
            searchField: query.searchField,
            search: query.search,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection
        });
    }
    getPageCursor(query) {
        return getCursorForPage(query.page, query.limit, {
            category: normalizeCategory(query.category),
            status: query.status,
            updatedAtFrom: query.updatedAtFrom,
            searchField: query.searchField,
            search: query.search,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection
        });
    }
    getById(id) {
        return getShoppingItem(id);
    }
    create(input) {
        return createShoppingItem(input);
    }
    update(id, patch, version) {
        return updateShoppingItem(id, patch, version);
    }
    increment(id, field, incrementBy) {
        return incrementItemValue(id, field, incrementBy);
    }
    remove(id) {
        return deleteShoppingItem(id);
    }
};
ShoppingService = __decorate([
    Injectable()
], ShoppingService);
export { ShoppingService };
