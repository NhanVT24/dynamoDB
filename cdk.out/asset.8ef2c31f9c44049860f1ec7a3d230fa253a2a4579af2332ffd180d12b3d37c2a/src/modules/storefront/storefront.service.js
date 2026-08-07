var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable, NotFoundException } from "@nestjs/common";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { createStorefrontOrder, getStorefrontProductById, listOrdersByCustomer, listStorefrontProducts } from "./storefront.repository.js";
let StorefrontService = class StorefrontService {
    listProducts(rawQuery) {
        const query = shoppingListQuerySchema.parse(rawQuery);
        return listStorefrontProducts(query);
    }
    async getProductById(id) {
        const item = await getStorefrontProductById(id);
        if (!item)
            throw new NotFoundException("Product not found");
        return item;
    }
    createOrder(email, input) {
        return createStorefrontOrder({ email, items: input.items });
    }
    listMyOrders(email) {
        return listOrdersByCustomer(email);
    }
};
StorefrontService = __decorate([
    Injectable()
], StorefrontService);
export { StorefrontService };
