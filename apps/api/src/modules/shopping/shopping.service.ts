import { Inject, Injectable } from "@nestjs/common";
import type { CognitoPrincipal } from "../../common/auth/cognito-principal.js";
import {
  getShoppingItemsPageCursor,
  getMockShoppingItem,
  getShoppingItem,
  listAllShoppingItems,
  listMockShoppingItems,
  listShoppingItems
} from "./shopping.repository.js";
import {
  normalizeCategory,
  shoppingCategories,
  shoppingStatuses
} from "./shopping.schema.js";
import type { ProductRecord } from "./product.types.js";
import type { ProductChanges } from "./domain/product.js";
import { UpdateProduct } from "./application/update-product/update-product.js";
import { IncrementProductField } from "./application/increment-product-field/increment-product-field.js";
import { CreateProduct } from "./application/create-product/create-product.js";
import { DeleteProduct } from "./application/delete-product/delete-product.js";
import type { NewProductDetails } from "./domain/product.js";
import type { ProductCounterField } from "./domain/counter-policy.js";

@Injectable()
export class ShoppingService {
  constructor(
    @Inject(UpdateProduct) private readonly updateProduct: UpdateProduct<ProductRecord>,
    @Inject(IncrementProductField) private readonly incrementProduct: IncrementProductField<ProductRecord>,
    @Inject(CreateProduct) private readonly createProduct: CreateProduct<ProductRecord>,
    @Inject(DeleteProduct) private readonly deleteProduct: DeleteProduct
  ) {}

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

  createShoppingItem(input: NewProductDetails, principal: CognitoPrincipal) {
    return this.createProduct.execute({ details: input,
      actor: { subject: principal.subject, isAdmin: principal.role === "admin" } });
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

  async updateShoppingItem(id: string, patch: ProductChanges, version: number, principal: CognitoPrincipal) {
    return this.updateProduct.execute({
      productId: id, changes: patch, expectedVersion: version,
      actor: { subject: principal.subject, isAdmin: principal.role === "admin" }
    });
  }

  async incrementShoppingItemField(id: string, field: ProductCounterField, incrementBy: number, principal: CognitoPrincipal) {
    return this.incrementProduct.execute({ productId: id, field, incrementBy,
      actor: { subject: principal.subject, isAdmin: principal.role === "admin" } });
  }

  async deleteShoppingItem(id: string, principal: CognitoPrincipal) {
    return this.deleteProduct.execute({ productId: id,
      actor: { subject: principal.subject, isAdmin: principal.role === "admin" } });
  }
}
