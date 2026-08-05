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
var ShoppingController_1;
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { ShoppingService } from "./shopping.service.js";
import { createShoppingItemSchema, updateShoppingItemSchema } from "./shopping.schema.js";
import { shoppingIncrementBodySchema, shoppingListAllQuerySchema, shoppingListQuerySchema, shoppingPageCursorQuerySchema, shoppingParamsSchema, shoppingUpdateBodySchema } from "./shopping.query-schemas.js";
let ShoppingController = ShoppingController_1 = class ShoppingController {
    shoppingService;
    logger = new Logger(ShoppingController_1.name);
    constructor(shoppingService) {
        this.shoppingService = shoppingService;
    }
    getDemo() {
        return this.shoppingService.listMockItems();
    }
    getDemoItem(params) {
        const { id } = shoppingParamsSchema.parse(params);
        const item = this.shoppingService.getMockItem(id);
        if (!item)
            throw new NotFoundException("Mock product not found");
        return item;
    }
    getMeta() {
        return this.shoppingService.getMeta();
    }
    list(rawQuery) {
        const query = shoppingListQuerySchema.parse(rawQuery);
        this.logger.log(`shopping list request ${JSON.stringify(query)}`);
        return this.shoppingService.list(query);
    }
    listAll(rawQuery) {
        const query = shoppingListAllQuerySchema.parse(rawQuery);
        this.logger.log(`shopping all request ${JSON.stringify(query)}`);
        return this.shoppingService.listAll(query);
    }
    getPageCursor(rawQuery) {
        const query = shoppingPageCursorQuerySchema.parse(rawQuery);
        this.logger.log(`shopping page-cursor request ${JSON.stringify(query)}`);
        return this.shoppingService.getPageCursor(query);
    }
    async getById(params) {
        const { id } = shoppingParamsSchema.parse(params);
        const item = await this.shoppingService.getById(id);
        if (!item)
            throw new NotFoundException("Product not found");
        return item;
    }
    create(rawBody) {
        const input = createShoppingItemSchema.parse(rawBody);
        return this.shoppingService.create(input);
    }
    update(params, rawBody) {
        const { id } = shoppingParamsSchema.parse(params);
        const body = updateShoppingItemSchema.merge(shoppingUpdateBodySchema).parse(rawBody);
        const { version, ...patch } = body;
        return this.shoppingService.update(id, patch, version);
    }
    increment(params, rawBody) {
        const { id } = shoppingParamsSchema.parse(params);
        const body = shoppingIncrementBodySchema.parse(rawBody);
        return this.shoppingService.increment(id, body.field, body.incrementBy);
    }
    async remove(params) {
        const { id } = shoppingParamsSchema.parse(params);
        await this.shoppingService.remove(id);
    }
};
__decorate([
    Get("demo"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "getDemo", null);
__decorate([
    Get("demo/:id"),
    __param(0, Param()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "getDemoItem", null);
__decorate([
    Get("meta"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "getMeta", null);
__decorate([
    Get(),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "list", null);
__decorate([
    Get("all"),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "listAll", null);
__decorate([
    Get("page-cursor"),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "getPageCursor", null);
__decorate([
    Get(":id"),
    __param(0, Param()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ShoppingController.prototype, "getById", null);
__decorate([
    Post(),
    HttpCode(HttpStatus.CREATED),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "create", null);
__decorate([
    Patch(":id"),
    __param(0, Param()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "update", null);
__decorate([
    Patch(":id/increment"),
    __param(0, Param()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ShoppingController.prototype, "increment", null);
__decorate([
    Delete(":id"),
    HttpCode(HttpStatus.NO_CONTENT),
    __param(0, Param()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ShoppingController.prototype, "remove", null);
ShoppingController = ShoppingController_1 = __decorate([
    Controller("api/shopping-items"),
    __metadata("design:paramtypes", [ShoppingService])
], ShoppingController);
export { ShoppingController };
