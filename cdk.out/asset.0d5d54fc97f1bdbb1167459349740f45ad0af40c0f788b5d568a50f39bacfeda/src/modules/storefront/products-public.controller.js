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
import { Controller, Get, Param, Query } from "@nestjs/common";
import { shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { StorefrontService } from "./storefront.service.js";
let ProductsPublicController = class ProductsPublicController {
    storefrontService;
    constructor(storefrontService) {
        this.storefrontService = storefrontService;
    }
    listProducts(rawQuery) {
        return this.storefrontService.listProducts(rawQuery);
    }
    getProductById(params) {
        const { id } = shoppingParamsSchema.parse(params);
        return this.storefrontService.getProductById(id);
    }
};
__decorate([
    Get(),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProductsPublicController.prototype, "listProducts", null);
__decorate([
    Get(":id"),
    __param(0, Param()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProductsPublicController.prototype, "getProductById", null);
ProductsPublicController = __decorate([
    Controller("api/products"),
    __metadata("design:paramtypes", [StorefrontService])
], ProductsPublicController);
export { ProductsPublicController };
