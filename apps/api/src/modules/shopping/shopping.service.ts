import { ManagedProducts } from "./application/managed-products.js";
import { Inject, Injectable } from "@nestjs/common";
import type { CognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { getMockShoppingItem, listMockShoppingItems } from "./shopping.mock.js";
import {
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
import type { ShoppingListQuery, ShoppingListAllQuery, ShoppingPageCursorQuery } from "./shopping.query-schemas.js";

@Injectable()
export class ShoppingService {
  constructor(
    @Inject(UpdateProduct) private readonly updateProduct: UpdateProduct<ProductRecord>,
    @Inject(IncrementProductField) private readonly incrementProduct: IncrementProductField<ProductRecord>,
    @Inject(CreateProduct) private readonly createProduct: CreateProduct<ProductRecord>,
    @Inject(DeleteProduct) private readonly deleteProduct: DeleteProduct,
    @Inject(ManagedProducts) private readonly reads: ManagedProducts<ProductRecord, unknown, unknown, unknown>
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

  listShoppingItems(query: ShoppingListQuery) { return this.reads.list(query); }

  listAllShoppingItems(query: ShoppingListAllQuery) { return this.reads.all(query); }

  getShoppingItemsPageCursor(query: ShoppingPageCursorQuery) { return this.reads.cursor(query); }

  getShoppingItemById(id: string) {
    return this.reads.find(id);
  }

  createShoppingItem(input: NewProductDetails, principal: CognitoPrincipal) {
    return this.createProduct.execute({ details: input,
      actor: { subject: principal.subject, isAdmin: principal.role === "admin" } });
  }

  listOwnedShoppingItems(subject: string) { return this.reads.owned(subject); }

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
