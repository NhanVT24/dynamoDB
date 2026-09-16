import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import {
  createShoppingItem,
  deleteShoppingItem,
  getShoppingItemsPageCursor,
  getMockShoppingItem,
  getShoppingItem,
  listAllShoppingItems,
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
  constructor(private readonly notificationsService: NotificationsService) {}

  listDemoShoppingItems() {
    return listMockShoppingItems();
  }

  getDemoShoppingItemById(id: string) {
    return getMockShoppingItem(id);
  }

  getShoppingItemMetadata() {
    return {
      categories: shoppingCategories,
      statuses: shoppingStatuses,
      searchFields: ["name", "brand"]
    };
  }

  listShoppingItems(query: Record<string, any>) {
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

  listAllShoppingItems(query: Record<string, any>) {
    return listAllShoppingItems(query.pageLimit, query.maxPages, {
      category: normalizeCategory(query.category) as string | undefined,
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  }

  getShoppingItemsPageCursor(query: Record<string, any>) {
    return getShoppingItemsPageCursor(query.page, query.limit, {
      category: normalizeCategory(query.category) as string | undefined,
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  }

  getShoppingItemById(id: string) {
    return getShoppingItem(id);
  }

  createShoppingItem(input: Record<string, any>, ownerSub: string) {
    return createShoppingItem(input, ownerSub);
  }

  async listOwnedShoppingItems(ownerSub: string) {
    const result = await listAllShoppingItems(100, 20, {
      sortBy: "updatedAt",
      sortDirection: "desc"
    });
    return {
      items: result.items.filter((item) => String(item.ownerSub ?? "") === ownerSub)
    };
  }

  async updateShoppingItem(id: string, patch: Record<string, any>, version: number, principal: CognitoPrincipal) {
    const current = await getShoppingItem(id);
    this.assertCanManageProduct(current, principal);
    const updated = await updateShoppingItem(id, patch, version, principal.role === "admin" ? undefined : principal.subject);
    await this.publishInventoryAlertIfNeeded(current, updated, "admin.update");
    return updated;
  }

  async incrementShoppingItemField(id: string, field: string, incrementBy: number, principal: CognitoPrincipal) {
    const current = await getShoppingItem(id);
    this.assertCanManageProduct(current, principal);
    const updated = await incrementItemValue(id, field, incrementBy, principal.role === "admin" ? undefined : principal.subject);
    await this.publishInventoryAlertIfNeeded(current, updated, "admin.increment");
    return updated;
  }

  async deleteShoppingItem(id: string, principal: CognitoPrincipal) {
    const current = await getShoppingItem(id);
    this.assertCanManageProduct(current, principal);
    return deleteShoppingItem(id, principal.role === "admin" ? undefined : principal.subject);
  }

  private assertCanManageProduct(product: Record<string, any> | null, principal: CognitoPrincipal) {
    if (!product) throw new NotFoundException("Product not found");
    if (principal.role !== "admin" && String(product.ownerSub ?? "") !== principal.subject) {
      throw new ForbiddenException("You can only modify products that you created.");
    }
  }

  private async publishInventoryAlertIfNeeded(
    current: Record<string, any> | null,
    updated: Record<string, any> | null,
    source: "admin.update" | "admin.increment"
  ) {
    if (!updated) {
      return;
    }

    const nextStatus = String(updated.status ?? "");
    if (nextStatus !== "low_stock" && nextStatus !== "out_of_stock") {
      return;
    }

    const previousStatus = String(current?.status ?? "");
    if (previousStatus === nextStatus) {
      return;
    }

    await this.notificationsService.publishInventoryStockAlert({
      productId: String(updated.id ?? ""),
      productName: String(updated.name ?? ""),
      sku: updated.sku ? String(updated.sku) : undefined,
      stock: Number(updated.stock ?? 0),
      previousStock: Number(current?.stock ?? 0),
      status: nextStatus,
      previousStatus,
      source
    });
  }
}
