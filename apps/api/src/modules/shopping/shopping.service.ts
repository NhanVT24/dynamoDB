import { ConflictException, Injectable } from "@nestjs/common";
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

  createShoppingItem(input: Record<string, any>) {
    return createShoppingItem(input);
  }

  async updateShoppingItem(id: string, patch: Record<string, any>, version: number) {
    const current = await getShoppingItem(id);
    this.ensureStockCanCoverReservations(current, patch.stock);
    const updated = await updateShoppingItem(id, patch, version);
    await this.publishInventoryAlertIfNeeded(current, updated, "admin.update");
    return updated;
  }

  async incrementShoppingItemField(id: string, field: string, incrementBy: number) {
    const current = await getShoppingItem(id);
    if (field === "stock") {
      const nextStock = Math.max(0, Number(current?.stock ?? 0) + incrementBy);
      this.ensureStockCanCoverReservations(current, nextStock);
    }
    const updated = await incrementItemValue(id, field, incrementBy);
    await this.publishInventoryAlertIfNeeded(current, updated, "admin.increment");
    return updated;
  }

  deleteShoppingItem(id: string) {
    return deleteShoppingItem(id);
  }

  private ensureStockCanCoverReservations(current: Record<string, any> | null, requestedStock: unknown) {
    if (!current || requestedStock === undefined) {
      return;
    }

    const stock = Number(requestedStock);
    const reservedStock = Number(current.reservedStock ?? 0);
    if (Number.isFinite(stock) && stock < reservedStock) {
      throw new ConflictException(
        `Cannot set stock to ${stock} because ${reservedStock} unit(s) are reserved by active checkouts.`
      );
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
