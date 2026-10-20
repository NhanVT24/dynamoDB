import { GetCheckoutStatus } from "./application/get-checkout-status/get-checkout-status.js";
import { FinalizeOrder } from "./application/finalize-order/finalize-order.js";
import { CreateCheckout } from "./application/create-checkout/create-checkout.js";
import { CancelOrder } from "./application/cancel-order/cancel-order.js";
import { RequestRefund } from "./application/request-refund/request-refund.js";
import { RefreshRefundStatus } from "./application/refresh-refund-status/refresh-refund-status.js";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { resolveSalePrice } from "../sales/sale-pricing.js";
import { listActiveSaleCampaigns } from "../sales/sales.repository.js";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { getShoppingItem } from "../shopping/shopping.repository.js";
import type { ProductRecord } from "../shopping/product.types.js";
import {
  getAwaitingPaymentOrder,
  getOrderById,
  listOrderItems,
  listOrdersByCustomer,
  listStorefrontProducts,
  type StorefrontOrderQueuePayload,
} from "./storefront.repository.js";
import type { CreateStorefrontOrderInput } from "./storefront.schema.js";

type PublicProductSummary = {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  originalPrice: number;
  status: string;
  stock: number;
  imageUrl?: string;
  rating?: number;
  soldCount?: number;
  location?: string;
  featured?: boolean;
  updatedAt?: string;
  isLocked?: boolean;
  lockedUntil?: string;
  saleCampaignId?: string;
  saleDiscountPercent?: number;
  saleEndsAt?: string;
};

type PublicProductDetail = PublicProductSummary & {
  description?: string;
  sku?: string;
  attributes: Record<string, unknown>;
};

type StorefrontQueueResult =
  | {
      type: "storefront.order.succeeded";
      outcome: "success";
      requestId: string;
      orderId: string;
      customer: string;
      status: "pending";
      totalAmount: number;
      itemCount: number;
    }
  | {
      type: "storefront.order.failed";
      outcome: "failed";
      requestId: string;
      orderId: "";
      customer: string;
      status: "failed";
      totalAmount: 0;
      itemCount: number;
      failureReason: string;
    };

function unwrapEventBridgeDetail<T extends Record<string, unknown>>(payload: T): T {
  const detail = payload.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as T
    : payload;
}

function toPublicProductSummary(item: ProductRecord, saleCampaigns = [] as Awaited<ReturnType<typeof listActiveSaleCampaigns>>): PublicProductSummary {
  const stock = Number(item.stock ?? 0);
  const status = stock <= 0 ? "out_of_stock" : stock <= 10 ? "low_stock" : String(item.status ?? "active");
  return {
    id: String(item.id),
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    ...resolveSalePrice(item, saleCampaigns),
    status,
    stock,
    imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    rating: item.rating == null ? undefined : Number(item.rating),
    soldCount: item.soldCount == null ? undefined : Number(item.soldCount),
    location: item.location ? String(item.location) : undefined,
    featured: Boolean(item.featured),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    isLocked: false
  };
}

function toPublicProductDetail(item: ProductRecord, saleCampaigns = [] as Awaited<ReturnType<typeof listActiveSaleCampaigns>>): PublicProductDetail {
  const {
    PK: _pk,
    SK: _sk,
    entityType: _entityType,
    version: _version,
    searchName: _searchName,
    searchField: _searchField,
    createdAt: _createdAt,
    id,
    name,
    category,
    brand,
    price,
    originalPrice,
    status,
    stock,
    imageUrl,
    rating,
    soldCount,
    location,
    featured,
    updatedAt,
    description,
    sku,
    ...attributes
  } = item;
  const numericStock = Number(stock ?? 0);
  const publicStatus = numericStock <= 0 ? "out_of_stock" : numericStock <= 10 ? "low_stock" : String(status ?? "active");

  return {
    id: String(id),
    name: String(name ?? ""),
    category: String(category ?? ""),
    brand: String(brand ?? ""),
    ...resolveSalePrice(item, saleCampaigns),
    status: publicStatus,
    stock: numericStock,
    imageUrl: imageUrl ? String(imageUrl) : undefined,
    rating: rating == null ? undefined : Number(rating),
    soldCount: soldCount == null ? undefined : Number(soldCount),
    location: location ? String(location) : undefined,
    featured: Boolean(featured),
    updatedAt: updatedAt ? String(updatedAt) : undefined,
    description: description ? String(description) : undefined,
    sku: sku ? String(sku) : undefined,
    isLocked: false,
    attributes
  };
}

function hasPhysicalStock(item: Record<string, unknown>) {
  return Number(item.stock ?? 0) > 0;
}

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    @Inject(CancelOrder) private readonly cancelOrderUseCase: CancelOrder,
    @Inject(RequestRefund) private readonly requestRefundUseCase: RequestRefund,
    @Inject(RefreshRefundStatus) private readonly refreshRefundUseCase: RefreshRefundStatus,
    @Inject(CreateCheckout) private readonly createCheckout: CreateCheckout,
    @Inject(FinalizeOrder) private readonly finalizeOrder: FinalizeOrder,
    @Inject(GetCheckoutStatus) private readonly checkoutStatus: GetCheckoutStatus
  ) {}

  async listProducts(rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    const result = await listStorefrontProducts(query);
    const saleCampaigns = await listActiveSaleCampaigns();

    const shaped = {
      // Sold-out products remain available to admin tools but not shoppers.
      items: result.items.filter(hasPhysicalStock).map((item) => toPublicProductSummary(item, saleCampaigns)),
      pageInfo: {
        limit: result.limit,
        cursor: result.cursor,
        nextCursor: result.nextCursor,
        hasNextPage: result.hasNextPage
      }
    };

    return shaped;
  }

  async getProductById(id: string) {
    const item = await getShoppingItem(id);
    if (!item || !hasPhysicalStock(item)) {
      throw new NotFoundException("Not found product.");
    }

    const shaped = toPublicProductDetail(item, await listActiveSaleCampaigns());
    return shaped;
  }

  getOrderStatus(email: string, orderId: string) { return this.checkoutStatus.execute(email, orderId); }

  async getOrderDetails(email: string, orderId: string) {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId || normalizedOrderId.length > 128) throw new NotFoundException("Order not found.");

    const order = await getOrderById(normalizedOrderId);
    if (order) {
      if (order.customerEmail !== email) throw new NotFoundException("Order not found.");
      return {
        id: order.id,
        customerEmail: order.customerEmail,
        status: order.status,
        items: order.items,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        serverNow: new Date().toISOString()
      };
    }

    const awaitingOrder = await getAwaitingPaymentOrder(normalizedOrderId);
    if (!awaitingOrder || awaitingOrder.customerEmail !== email) throw new NotFoundException("Order not found.");
    const items = await listOrderItems(normalizedOrderId);
    return {
      id: normalizedOrderId,
      customerEmail: awaitingOrder.customerEmail,
      status: awaitingOrder.status,
      items: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        price: item.unitPrice,
        originalUnitPrice: item.originalUnitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal
      })),
      totalAmount: awaitingOrder.totalAmount,
      createdAt: awaitingOrder.createdAt,
      updatedAt: awaitingOrder.updatedAt,
      serverNow: new Date().toISOString(),
      paymentConfirmedAt: awaitingOrder.paymentConfirmedAt,
      refundStatus: awaitingOrder.refundStatus,
      refundUpdatedAt: awaitingOrder.refundUpdatedAt
    };
  }

  createOrder(email: string, input: CreateStorefrontOrderInput) {
    return this.createCheckout.execute(email, { ...input,
      items: input.items.map(item => ({ productId: item.productId ?? "", quantity: item.quantity })) });
  }

  cancelOrder(email: string, orderId: string) { return this.cancelOrderUseCase.execute(email, orderId); }

  refundOrder(email: string, orderId: string) { return this.requestRefundUseCase.execute(email, orderId); }

  refreshRefundStatus(email: string, orderId: string) { return this.refreshRefundUseCase.execute(email, orderId); }

  async processQueueRecords(
    records: Array<{ body?: string; messageId?: string }>,
    _options?: { queueName?: string; workerName?: string }
  ) {
    const settled = await Promise.allSettled(records.map(async (record) => ({
      messageId: String(record.messageId ?? ""),
      item: await this.processQueueRecord(record.body)
    })));

    const processedItems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ messageId: string; item: StorefrontQueueResult | null }>).value.item)
      .filter(Boolean);

    const failedMessageIds = settled
      .flatMap((result, index) => result.status === "rejected" ? [String(records[index]?.messageId ?? "")] : [])
      .filter(Boolean);

    return {
      processed: processedItems.length,
      failedMessageIds,
      items: processedItems
    };
  }

  listMyOrders(email: string) {
    return listOrdersByCustomer(email);
  }

  async finalizeWorkflowOrder(input: {
    email: string;
    items: CreateStorefrontOrderInput["items"];
    requestId?: string;
  }) {
    return this.finalizeQueuedOrder(input.email, input.items, input.requestId);
  }

  private async processQueueRecord(body: string | undefined) {
    if (!body) {
      logQueueWarn(this.logger, {
        queue: "storefrontOrders",
        status: "record_empty"
      });
      return null;
    }

    const payload = unwrapEventBridgeDetail(JSON.parse(body) as Record<string, unknown>) as Partial<StorefrontOrderQueuePayload>;
    if (payload.type !== "storefront.order.requested" || !payload.email || !Array.isArray(payload.items) || payload.items.length === 0) {
      logQueueWarn(this.logger, {
        queue: "storefrontOrders",
        eventType: "storefront.order.requested",
        status: "ignored_payload"
      });
      return null;
    }
    return this.finalizeQueuedOrder(payload.email, payload.items, payload.requestId);
  }

  private finalizeQueuedOrder(email: string, items: CreateStorefrontOrderInput["items"], requestId?: string): Promise<StorefrontQueueResult> {
    return this.finalizeOrder.execute(email, items.map(item => ({ productId: item.productId ?? "", quantity: item.quantity })), requestId);
  }
}
