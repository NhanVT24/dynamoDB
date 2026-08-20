import crypto from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { TtlCache } from "../../common/cache/ttl-cache.js";
import {
  logQueueBusinessEvent,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { env } from "../../config/env.js";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import { sendOrderConfirmationEmail, sendOrderFailureEmail } from "../../integrations/ses/order-mailer.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { VnpayService } from "../vnpay/vnpay.service.js";
import {
  acquireProductSelectionLock,
  createCheckoutGateRequest,
  createStorefrontOrder,
  getCheckoutGateRequestById,
  getActiveProductSelectionLock,
  getStorefrontProductById,
  releaseProductSelectionLock,
  type InventoryStockChange,
  listOrdersByCustomer,
  listStorefrontProducts,
  type CheckoutGateQueuePayload,
  type StorefrontOrderQueuePayload
  ,
  updateCheckoutGateRequestStatus
} from "./storefront.repository.js";
import type { CreateStorefrontOrderInput, PrepareStorefrontCheckoutInput } from "./storefront.schema.js";

type ProductRecord = Record<string, any>;
type PublicProductListResponse = {
  items: PublicProductSummary[];
  pageInfo: {
    limit: number;
    cursor: string | null;
    nextCursor: string | null;
    hasNextPage: boolean;
  };
};

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

function normalizeOrderItems(items: Array<{ productId?: string; quantity: number }>) {
  const merged = new Map<string, number>();

  for (const item of items) {
    const productId = String(item.productId ?? "").trim().replace(/^PRODUCT#/i, "");
    const quantity = Number(item.quantity ?? 0);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }

  return [...merged.entries()].map(([productId, quantity]): { productId: string; quantity: number } => ({
    productId,
    quantity
  }));
}

function unwrapEventBridgeDetail<T extends Record<string, unknown>>(payload: T): T {
  const detail = payload.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as T
    : payload;
}

const listCache = new TtlCache<PublicProductListResponse>(20_000);
const detailCache = new TtlCache<PublicProductDetail>(30_000);

function buildListCacheKey(query: Record<string, unknown>) {
  return JSON.stringify(Object.keys(query).sort().map((key) => [key, query[key as keyof typeof query]]));
}

function toPublicProductSummary(item: ProductRecord): PublicProductSummary {
  return {
    id: String(item.id),
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    price: Number(item.price ?? 0),
    originalPrice: Number(item.originalPrice ?? item.price ?? 0),
    status: String(item.status ?? ""),
    stock: Number(item.stock ?? 0),
    imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    rating: item.rating == null ? undefined : Number(item.rating),
    soldCount: item.soldCount == null ? undefined : Number(item.soldCount),
    location: item.location ? String(item.location) : undefined,
    featured: Boolean(item.featured),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    isLocked: Boolean(item.isLocked),
    lockedUntil: item.lockedUntil ? String(item.lockedUntil) : undefined
  };
}

function toPublicProductDetail(item: ProductRecord): PublicProductDetail {
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

  return {
    id: String(id),
    name: String(name ?? ""),
    category: String(category ?? ""),
    brand: String(brand ?? ""),
    price: Number(price ?? 0),
    originalPrice: Number(originalPrice ?? price ?? 0),
    status: String(status ?? ""),
    stock: Number(stock ?? 0),
    imageUrl: imageUrl ? String(imageUrl) : undefined,
    rating: rating == null ? undefined : Number(rating),
    soldCount: soldCount == null ? undefined : Number(soldCount),
    location: location ? String(location) : undefined,
    featured: Boolean(featured),
    updatedAt: updatedAt ? String(updatedAt) : undefined,
    description: description ? String(description) : undefined,
    sku: sku ? String(sku) : undefined,
    isLocked: Boolean(item.isLocked),
    lockedUntil: item.lockedUntil ? String(item.lockedUntil) : undefined,
    attributes
  };
}

function isInsufficientStockError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Insufficient stock for ");
}

function shouldProcessCommerceQueuesInline() {
  if (env.STOREFRONT_SYNC_QUEUE_PROCESSING) {
    return true;
  }

  return Boolean(env.DYNAMODB_ENDPOINT) && process.env.NODE_ENV !== "production";
}

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly vnpayService: VnpayService
  ) {}

  async listProducts(rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    const cacheKey = buildListCacheKey(query);
    const cached = listCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await listStorefrontProducts(query);
    const itemsWithLockState = await Promise.all(
      result.items.map(async (item) => {
        const lock = await getActiveProductSelectionLock(String(item.id));
        return {
          ...item,
          isLocked: Boolean(lock),
          lockedUntil: lock?.lockedUntil
        };
      })
    );

    const shaped = {
      items: itemsWithLockState.map((item) => toPublicProductSummary(item)),
      pageInfo: {
        limit: result.limit,
        cursor: result.cursor,
        nextCursor: result.nextCursor,
        hasNextPage: result.hasNextPage
      }
    };

    listCache.set(cacheKey, shaped);
    return shaped;
  }

  async getProductById(id: string) {
    const cached = detailCache.get(id);
    if (cached) {
      return cached;
    }

    const item = await getStorefrontProductById(id);
    if (!item) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }

    const lock = await getActiveProductSelectionLock(id);
    const shaped = toPublicProductDetail({
      ...item,
      isLocked: Boolean(lock),
      lockedUntil: lock?.lockedUntil
    });
    detailCache.set(id, shaped);
    return shaped;
  }

  async prepareCheckout(email: string, input: PrepareStorefrontCheckoutInput) {
    if (!env.EVENTBRIDGE_COMMERCE_BUS_NAME) {
      throw new Error("Hàng đợi duyệt checkout chưa được cấu hình.");
    }

    const normalizedItems = normalizeOrderItems(input.items);
    await this.precheckProducts(email, normalizedItems);

    const requestId = crypto.randomUUID();
    await createCheckoutGateRequest({
      requestId,
      email,
      items: normalizedItems,
      locale: input.locale,
      bankCode: input.bankCode
    });

    const payload: CheckoutGateQueuePayload = {
      type: "storefront.checkout.gate.requested",
      requestId,
      email,
      items: normalizedItems,
      locale: input.locale,
      bankCode: input.bankCode,
      createdAt: new Date().toISOString()
    };

    if (shouldProcessCommerceQueuesInline()) {
      this.logger.log(`[eventbridge-commerce] inline_checkout_gate requestId=${requestId} customer=${email} itemCount=${normalizedItems.length}`);
      await this.resolveCheckoutGate(payload);
    } else {
      await publishEventBridgeEvent({
        busName: env.EVENTBRIDGE_COMMERCE_BUS_NAME,
        source: "supermarket.commerce",
        detailType: "storefront.checkout.gate.requested",
        detail: payload as unknown as Record<string, unknown>
      });
    }

    return {
      success: true,
      queued: true,
      requestId,
      status: "pending",
      message: "Yêu cầu checkout đã vào hàng đợi kiểm tra tồn kho."
    };
  }

  async getCheckoutGateStatus(email: string, requestId: string) {
    const gate = await getCheckoutGateRequestById(requestId);
    if (!gate || gate.customerEmail !== email) {
      throw new NotFoundException("Không tìm thấy yêu cầu checkout.");
    }

    return {
      requestId: gate.requestId,
      status: gate.status,
      message: gate.message || "",
      failureCode: gate.failureCode || "",
      paymentUrl: gate.paymentUrl || "",
      lockedUntil: gate.lockedUntil || ""
    };
  }

  async createOrder(email: string, input: CreateStorefrontOrderInput) {
    if (!env.EVENTBRIDGE_COMMERCE_BUS_NAME) {
      this.logger.warn(`[eventbridge-commerce] disabled customer=${email}`);
      throw new Error("Hàng đợi xử lý đơn hàng chưa được cấu hình.");
    }

    const normalizedItems = normalizeOrderItems(input.items);
    this.logger.log(`[eventbridge-commerce] create_order_begin customer=${email} itemCount=${normalizedItems.length} productIds=${normalizedItems.map((item) => item.productId).join(",")}`);
    try {
      await this.precheckProducts(email, normalizedItems);
    } catch (error) {
      this.logger.error(
        `[eventbridge-commerce] create_order_error stage=precheck customer=${email} itemCount=${normalizedItems.length} message=${error instanceof Error ? error.message : "unknown_error"}`
      );
      throw error;
    }
    this.logger.log(`[eventbridge-commerce] create_order_precheck_done customer=${email} itemCount=${normalizedItems.length}`);

    const requestId = input.requestId?.trim() || crypto.randomUUID();
    const payload: StorefrontOrderQueuePayload = {
      type: "storefront.order.requested",
      requestId,
      email,
      items: normalizedItems,
      createdAt: new Date().toISOString()
    };

    this.logger.log(`[eventbridge-commerce] create_order_publish_begin requestId=${requestId} customer=${email} detailType=storefront.order.requested`);
    if (shouldProcessCommerceQueuesInline()) {
      this.logger.log(`[eventbridge-commerce] inline_order_processing requestId=${requestId} customer=${email} itemCount=${normalizedItems.length}`);
      await this.finalizeQueuedOrder(email, normalizedItems, requestId);
    } else {
      let published: Awaited<ReturnType<typeof publishEventBridgeEvent>>;
      try {
        published = await publishEventBridgeEvent({
          busName: env.EVENTBRIDGE_COMMERCE_BUS_NAME,
          source: "supermarket.commerce",
          detailType: "storefront.order.requested",
          detail: payload as unknown as Record<string, unknown>
        });
      } catch (error) {
        this.logger.error(
          `[eventbridge-commerce] create_order_error stage=publish customer=${email} requestId=${requestId} message=${error instanceof Error ? error.message : "unknown_error"}`
        );
        throw error;
      }

      this.logger.log(`[eventbridge-commerce] create_order_publish_done requestId=${requestId} customer=${email} itemCount=${normalizedItems.length} bus=${published.eventBusName} eventId=${published.eventId}`);
    }

    return {
      success: true,
      queued: true,
      requestId,
      message: "Yêu cầu đặt hàng đã được đưa vào queue để xử lý."
    };
  }

  async processQueueRecords(
    records: Array<{ body?: string; messageId?: string }>,
    options?: { queueName?: string; workerName?: string }
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

  async processCheckoutGateRecords(
    records: Array<{ body?: string; messageId?: string }>,
    _options?: { queueName?: string; workerName?: string }
  ) {
    const settled = await Promise.allSettled(records.map(async (record) => ({
      messageId: String(record.messageId ?? ""),
      item: await this.processCheckoutGateRecord(record.body)
    })));

    const processedItems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ messageId: string; item: unknown }>).value.item)
      .filter(Boolean);

    const failedMessageIds = settled
      .flatMap((result, index) => result.status === "rejected" ? [String(records[index]?.messageId ?? "")] : [])
      .filter(Boolean);

    settled.forEach((result, index) => {
      if (result.status !== "rejected") {
        return;
      }

      const messageId = String(records[index]?.messageId ?? "");
      const reason = result.reason instanceof Error
        ? {
            name: result.reason.name,
            message: result.reason.message,
            stack: result.reason.stack
          }
        : {
            message: String(result.reason ?? "unknown")
          };

      this.logger.error(JSON.stringify({
        scope: "queue",
        kind: "error",
        queue: "checkoutGate",
        status: "record_failed",
        messageId,
        reason
      }));
    });

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

  private async processCheckoutGateRecord(body: string | undefined) {
    if (!body) {
      logQueueWarn(this.logger, {
        queue: "checkoutGate",
        status: "record_empty"
      });
      return null;
    }

    const payload = unwrapEventBridgeDetail(JSON.parse(body) as Record<string, unknown>) as Partial<CheckoutGateQueuePayload>;
    if (payload.type !== "storefront.checkout.gate.requested" || !payload.email || !payload.requestId || !Array.isArray(payload.items) || payload.items.length === 0) {
      logQueueWarn(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "ignored_payload"
      });
      return null;
    }

    return this.resolveCheckoutGate(payload as CheckoutGateQueuePayload);
  }

  private async resolveCheckoutGate(payload: CheckoutGateQueuePayload) {
    const normalizedItems = normalizeOrderItems(payload.items);
    const acquiredLocks: Array<{ productId: string }> = [];

    try {
      for (const item of normalizedItems) {
        const product = await getStorefrontProductById(item.productId);
        if (!product) {
          throw new Error(`Không tìm thấy sản phẩm ${item.productId}.`);
        }

        if (Number(product.stock ?? 0) < item.quantity) {
          throw new Error(`Sản phẩm ${product.name} hiện không đủ số lượng.`);
        }

        await acquireProductSelectionLock({
          productId: item.productId,
          email: payload.email,
          requestId: payload.requestId,
          holdSeconds: 5 * 60
        });
        acquiredLocks.push({ productId: item.productId });
      }

      const firstProduct = await getStorefrontProductById(normalizedItems[0]?.productId ?? "");
      const payment = await this.vnpayService.createWorkflowPaymentUrl({
        email: payload.email,
        items: normalizedItems,
        orderId: payload.requestId,
        orderDescription: firstProduct
          ? `Thanh toán giữ hàng ${firstProduct.name} - ${payload.requestId}`
          : `Thanh toán giữ hàng ${payload.requestId}`,
        bankCode: payload.bankCode,
        locale: payload.locale
      });

      await updateCheckoutGateRequestStatus({
        requestId: payload.requestId,
        expectedStatus: "pending",
        status: "allowed",
        message: "Giỏ hàng đã được giữ tạm. Bạn có thể tiếp tục thanh toán.",
        paymentUrl: payment.paymentUrl,
        lockedUntil: payment.expiresAt
      });

      logQueueBusinessEvent(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "allowed",
        requestId: payload.requestId
      });

      return {
        requestId: payload.requestId,
        status: "allowed"
      };
    } catch (error) {
      for (const lock of acquiredLocks) {
        try {
          await releaseProductSelectionLock(lock.productId, payload.requestId);
        } catch {}
      }

      const message = error instanceof Error ? error.message : "Không thể giữ chỗ sản phẩm lúc này.";
      await updateCheckoutGateRequestStatus({
        requestId: payload.requestId,
        expectedStatus: "pending",
        status: "blocked",
        message,
        failureCode: "inventory_gate_blocked"
      });

      logQueueBusinessEvent(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "blocked",
        requestId: payload.requestId
      });

      return {
        requestId: payload.requestId,
        status: "blocked",
        message
      };
    }
  }

  private async finalizeQueuedOrder(
    email: string,
    items: CreateStorefrontOrderInput["items"],
    requestId?: string
  ): Promise<StorefrontQueueResult> {
    const normalizedItems = normalizeOrderItems(items);
    try {
      const { order, stockChanges } = await createStorefrontOrder({ email, items: normalizedItems });
      this.invalidateProductCaches(normalizedItems.map((item) => item.productId));
      this.logger.log(`[dynamo-order] created orderId=${order.id} requestId=${requestId ?? ""} customer=${email} status=${order.status} totalAmount=${order.totalAmount} itemCount=${order.items.length}`);
      await this.publishInventoryAlertsFromOrder(stockChanges, email);

      await this.notificationsService.createPendingNotification({
        email,
        channel: "system",
        title: "Đơn hàng đang chờ xử lý",
        message: `Đơn hàng ${order.id} đã vào hàng đợi xử lý thông báo hệ thống.`,
        metadata: {
          requestId: requestId ?? "",
          orderId: order.id,
          totalAmount: order.totalAmount,
          itemCount: order.items.length
        }
      });

      await this.notificationsService.createPendingNotification({
        email,
        channel: "email",
        title: "Email xác nhận đang chờ gửi",
        message: `Hệ thống đã xếp hàng email xác nhận cho đơn ${order.id}. Đơn sẽ chuyển sang done sau khi gửi xong.`,
        metadata: {
          orderId: order.id,
          template: "order-confirmation"
        }
      });

      await this.notificationsService.publishAuditLog({
        eventType: "storefront.order.created",
        email,
        resourceId: order.id,
        metadata: {
          totalAmount: order.totalAmount,
          itemCount: order.items.length,
          status: order.status,
          requestId: requestId ?? ""
        }
      });

      if (env.SES_FROM_EMAIL) {
        try {
          await sendOrderConfirmationEmail({
            toEmail: email,
            orderId: order.id,
            totalAmount: order.totalAmount,
            createdAt: order.createdAt,
            items: order.items.map((item) => ({
              productName: item.productName,
              quantity: item.quantity,
              lineTotal: item.lineTotal
            }))
          });
          this.logger.log(`[mail-ses] order_success_sent orderId=${order.id} requestId=${requestId ?? ""} to=${email}`);
        } catch (error) {
          this.logger.warn(`[mail-ses] order_success_failed orderId=${order.id} requestId=${requestId ?? ""} to=${email} error=${error instanceof Error ? error.message : "unknown"}`);
        }
      } else {
        this.logger.warn(`[mail-ses] order_success_skipped orderId=${order.id} requestId=${requestId ?? ""} reason=ses_not_configured`);
      }

      await this.publishCommerceLifecycleEvent({
        detailType: "storefront.order.succeeded",
        detail: {
          type: "storefront.order.succeeded",
          requestId: requestId ?? "",
          orderId: order.id,
          customer: email,
          totalAmount: order.totalAmount,
          itemCount: order.items.length,
          status: order.status,
          createdAt: order.createdAt
        }
      });
      logQueueBusinessEvent(this.logger, {
        queue: "storefrontOrders",
        eventType: "storefront.order.requested",
        status: "processed",
        requestId: requestId ?? "",
        orderId: order.id
      });
      return {
        type: "storefront.order.succeeded",
        outcome: "success",
        requestId: requestId ?? "",
        orderId: order.id,
        customer: email,
        status: "pending",
        totalAmount: order.totalAmount,
        itemCount: order.items.length
      };
    } catch (error) {
      if (isInsufficientStockError(error)) {
        const failureReason = "Thanh toán thất bại vì sản phẩm không còn đủ tồn kho.";
        this.logger.warn(
          `[dynamo-stock] insufficient_after_queue requestId=${requestId ?? ""} customer=${email} reason=insufficient_stock error=${error.message}`
        );

        if (env.SES_FROM_EMAIL) {
          try {
            await sendOrderFailureEmail({
              toEmail: email,
              requestId,
              failureReason,
              items: await Promise.all(normalizedItems.map(async (item) => {
                const product = await getStorefrontProductById(item.productId);
                return {
                  productId: item.productId,
                  productName: product?.name ? String(product.name) : undefined,
                  quantity: item.quantity
                };
              }))
            });
            this.logger.log(`[mail-ses] order_failure_sent requestId=${requestId ?? ""} customer=${email}`);
          } catch (mailError) {
            this.logger.warn(
              `[mail-ses] order_failure_failed requestId=${requestId ?? ""} customer=${email} error=${mailError instanceof Error ? mailError.message : "unknown"}`
            );
          }
        }

        await this.notificationsService.createPendingNotification({
          email,
          channel: "system",
          title: "Thanh toán thất bại",
          message: failureReason,
          metadata: {
            requestId: requestId ?? "",
            itemCount: normalizedItems.length,
            failureCode: "insufficient_stock",
            failureReason
          }
        });

        await this.notificationsService.publishAuditLog({
          eventType: "storefront.order.failed",
          email,
          resourceId: requestId ?? "",
          metadata: {
            status: "failed",
            itemCount: normalizedItems.length,
            requestId: requestId ?? "",
            failureCode: "insufficient_stock",
            failureReason
          }
        });

        await this.publishCommerceLifecycleEvent({
          detailType: "storefront.order.failed",
          detail: {
            type: "storefront.order.failed",
            requestId: requestId ?? "",
            customer: email,
            itemCount: normalizedItems.length,
            failureReason,
            failureCode: "insufficient_stock",
            createdAt: new Date().toISOString()
          }
        });

        return {
          type: "storefront.order.failed",
          outcome: "failed",
          requestId: requestId ?? "",
          orderId: "",
          customer: email,
          status: "failed",
          totalAmount: 0,
          itemCount: normalizedItems.length,
          failureReason
        };
      }

      throw error;
    } finally {
      if (requestId) {
        await Promise.allSettled(normalizedItems.map(async (item) => {
          await releaseProductSelectionLock(item.productId, requestId);
        }));
      }
    }
  }

  private invalidateProductCaches(productIds: string[]) {
    listCache.clear();
    for (const productId of productIds) {
      detailCache.delete(productId);
    }
  }

  private async precheckProducts(email: string, items: CreateStorefrontOrderInput["items"]) {
    for (const item of items) {
      this.logger.log(`[dynamo-product] precheck_begin customer=${email} productId=${item.productId} quantity=${item.quantity}`);
      const product = await getStorefrontProductById(item.productId);

      if (!product) {
        this.logger.warn(`[dynamo-product] missing customer=${email} productId=${item.productId}`);
        throw new NotFoundException(`Không tìm thấy sản phẩm ${item.productId}.`);
      }
      this.logger.log(`[dynamo-product] precheck_found customer=${email} productId=${item.productId} quantity=${item.quantity} stock=${Number(product.stock ?? 0)} status=${String(product.status ?? "")} version=${Number(product.version ?? 0)}`);
    }
  }

  private async publishCommerceLifecycleEvent(input: {
    detailType: "storefront.order.succeeded" | "storefront.order.failed";
    detail: Record<string, unknown>;
  }) {
    if (!env.EVENTBRIDGE_COMMERCE_BUS_NAME) {
      this.logger.warn(`[eventbridge-commerce] lifecycle_disabled detailType=${input.detailType}`);
      return;
    }

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_COMMERCE_BUS_NAME,
      source: "supermarket.commerce",
      detailType: input.detailType,
      detail: input.detail
    });

    this.logger.log(`[eventbridge-commerce] lifecycle_published detailType=${input.detailType} bus=${published.eventBusName} eventId=${published.eventId}`);
  }

  private async publishInventoryAlertsFromOrder(changes: InventoryStockChange[], email: string) {
    for (const change of changes) {
      if ((change.status !== "low_stock" && change.status !== "out_of_stock") || change.previousStatus === change.status) {
        continue;
      }

      await this.notificationsService.publishInventoryStockAlert({
        productId: change.productId,
        productName: change.productName,
        sku: change.sku,
        stock: change.stock,
        previousStock: change.previousStock,
        status: change.status,
        previousStatus: change.previousStatus,
        source: "storefront.order",
        changedBy: email
      });
    }
  }
}
