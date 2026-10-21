import { Injectable } from "@nestjs/common";
import { SalesUseCases } from "./application/campaigns.js";
import type { ProductRecord } from "../shopping/product.types.js";
@Injectable()
export class SalesService extends SalesUseCases<ProductRecord> {}
