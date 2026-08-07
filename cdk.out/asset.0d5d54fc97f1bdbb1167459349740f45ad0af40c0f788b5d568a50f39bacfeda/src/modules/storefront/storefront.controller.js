var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var StorefrontController_1;
import { Body, Controller, ForbiddenException, Get, Logger, Param, Post, Query, Req } from "@nestjs/common";
import { shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { StorefrontService } from "./storefront.service.js";
import { createStorefrontOrderSchema } from "./storefront.schema.js";
let StorefrontController = StorefrontController_1 = class StorefrontController {
    storefrontService;
    logger = new Logger(StorefrontController_1.name);
    constructor(storefrontService) {
        this.storefrontService = storefrontService;
    }
    listProducts(rawQuery) {
        this.logger.log(`storefront products request ${JSON.stringify(rawQuery)}`);
        return this.storefrontService.listProducts(rawQuery);
    }
    getProductById(params) {
        const { id } = shoppingParamsSchema.parse(params);
        return this.storefrontService.getProductById(id);
    }
    createOrder(request, rawBody) {
        const principal = extractCognitoPrincipal(request.headers);
        if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
            throw new ForbiddenException("Chỉ tài khoản customer hoặc admin mới được tạo đơn hàng.");
        }
        const input = createStorefrontOrderSchema.parse(rawBody);
        return this.storefrontService.createOrder(principal.email, input);
    }
    listMyOrders(request) {
        const principal = extractCognitoPrincipal(request.headers);
        if (!principal) {
            throw new ForbiddenException("Bạn cần đăng nhập để xem đơn hàng.");
        }
        return this.storefrontService.listMyOrders(principal.email);
    }
};
__decorate([
    Get("products"),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StorefrontController.prototype, "listProducts", null);
__decorate([
    Get("products/:id"),
    __param(0, Param()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StorefrontController.prototype, "getProductById", null);
__decorate([
    Post("orders"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], StorefrontController.prototype, "createOrder", null);
__decorate([
    Get("orders/me"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StorefrontController.prototype, "listMyOrders", null);
StorefrontController = StorefrontController_1 = __decorate([
    Controller("api/storefront"),
    __metadata("design:paramtypes", [StorefrontService])
], StorefrontController);
export { StorefrontController };
