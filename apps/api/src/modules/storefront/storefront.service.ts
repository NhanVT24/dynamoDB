import { Injectable, NotFoundException } from "@nestjs/common";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { createStorefrontOrder, getStorefrontProductById, listOrdersByCustomer, listStorefrontProducts } from "./storefront.repository.js";
import type { CreateStorefrontOrderInput } from "./storefront.schema.js";

@Injectable()
export class StorefrontService {
  listProducts(rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    return listStorefrontProducts(query);
  }

  async getProductById(id: string) {
    const item = await getStorefrontProductById(id);
    if (!item) throw new NotFoundException("Product not found");
    return item;
  }

  createOrder(email: string, input: CreateStorefrontOrderInput) {
    return createStorefrontOrder({ email, items: input.items });
  }

  listMyOrders(email: string) {
    return listOrdersByCustomer(email);
  }
}
