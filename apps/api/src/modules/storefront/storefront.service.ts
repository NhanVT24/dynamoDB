import crypto from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  logQueueBusinessEvent,
  logQueueError,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { env } from "../../config/env.js";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import { sqsClient } from "../../integrations/sqs/client.js";
import { sendOrderConfirmationEmail, sendOrderFailureEmail } from "../../integrations/ses/order-mailer.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { resolveSalePrice } from "../sales/sale-pricing.js";
import { listActiveSaleCampaigns } from "../sales/sales.repository.js";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { VnpayService } from "../vnpay/vnpay.service.js";
import {
  createCheckoutReservations,
  arriveAtCheckoutRaceBarrier,
  createCheckoutGateRequest,
  createStorefrontOrder,
  getCheckoutGateRequestById,
  getStorefrontProductById,
  releaseCheckoutGateReservation,
  type InventoryStockChange,
  listCheckoutReservationsByRequestId,
  listOrdersByCustomer,
  listStorefrontProducts,
  type CheckoutGateQueuePayload,
  type StorefrontOrderQueuePayload
  ,
  updateCheckoutGateRequestStatus,
  waitForCheckoutRaceBarrier
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

function toPublicProductSummary(item: ProductRecord, saleCampaigns = [] as Awaited<ReturnType<typeof listActiveSaleCampaigns>>): PublicProductSummary {
  const stock = Number(item.stock ?? 0);
  const reservedStock = Number(item.reservedStock ?? 0);
  const availableStock = Math.max(0, stock - reservedStock);
  const status = availableStock <= 0 ? "out_of_stock" : availableStock <= 10 ? "low_stock" : String(item.status ?? "active");
  return {
    id: String(item.id),
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    ...resolveSalePrice(item, saleCampaigns),
    status,
    stock: availableStock,
    imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    rating: item.rating == null ? undefined : Number(item.rating),
    soldCount: item.soldCount == null ? undefined : Number(item.soldCount),
    location: item.location ? String(item.location) : undefined,
    featured: Boolean(item.featured),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    isLocked: availableStock <= 0 && reservedStock > 0,
    lockedUntil: item.lockedUntil ? String(item.lockedUntil) : undefined
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
  const reservedStock = Number(item.reservedStock ?? 0);
  const availableStock = Math.max(0, numericStock - reservedStock);
  const publicStatus = availableStock <= 0 ? "out_of_stock" : availableStock <= 10 ? "low_stock" : String(status ?? "active");

  return {
    id: String(id),
    name: String(name ?? ""),
    category: String(category ?? ""),
    brand: String(brand ?? ""),
    ...resolveSalePrice(item, saleCampaigns),
    status: publicStatus,
    stock: availableStock,
    imageUrl: imageUrl ? String(imageUrl) : undefined,
    rating: rating == null ? undefined : Number(rating),
    soldCount: soldCount == null ? undefined : Number(soldCount),
    location: location ? String(location) : undefined,
    featured: Boolean(featured),
    updatedAt: updatedAt ? String(updatedAt) : undefined,
    description: description ? String(description) : undefined,
    sku: sku ? String(sku) : undefined,
    isLocked: availableStock <= 0 && reservedStock > 0,
    lockedUntil: item.lockedUntil ? String(item.lockedUntil) : undefined,
    attributes
  };
}

function isInsufficientStockError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Insufficient stock for ");
}

function hasPhysicalStock(item: Record<string, unknown>) {
  return Number(item.stock ?? 0) > 0;
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
    const item = await getStorefrontProductById(id);
    if (!item || !hasPhysicalStock(item)) {
      throw new NotFoundException("Not found product.");
    }

    const shaped = toPublicProductDetail(item, await listActiveSaleCampaigns());
    return shaped;
  }

  async prepareCheckout(email: string, input: PrepareStorefrontCheckoutInput) {
    if (!env.SQS_CHECKOUT_GATE_QUEUE_URL) {
      throw new Error("Queue processing is not enabled. Cannot prepare checkout at this time.");
    }

    const normalizedItems = normalizeOrderItems(input.items);

    const requestId = crypto.randomUUID();
    await createCheckoutGateRequest({
      requestId,
      email,
      items: normalizedItems,
      locale: input.locale,
      bankCode: input.bankCode,
      processingMode: input.processingMode
    });
    this.logger.log(`[checkout-gate] request_created requestId=${requestId} customer=${email} itemCount=${normalizedItems.length} mode=${input.processingMode}`);

    const payload: CheckoutGateQueuePayload = {
      type: "storefront.checkout.gate.requested",
      requestId,
      email,
      items: normalizedItems,
      locale: input.locale,
      bankCode: input.bankCode,
      processingMode: input.processingMode,
      raceTestId: input.raceTestId,
      createdAt: new Date().toISOString()
    };

    if (shouldProcessCommerceQueuesInline()) {
      this.logger.log(`[eventbridge-commerce] inline_checkout_gate requestId=${requestId} customer=${email} itemCount=${normalizedItems.length}`);
      await this.resolveCheckoutGate(payload);
    } else {
      // Every checkout uses one FIFO lane. Splitting interactive and trigger
      // requests across two queues would break the global ordering guarantee.
      const queueUrl = env.SQS_CHECKOUT_GATE_QUEUE_URL;

      const sendResult = await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
        MessageGroupId: "checkout-gate-serial",
        MessageDeduplicationId: requestId
      }));
      this.logger.log(`[checkout-gate] request_enqueued requestId=${requestId} queueUrl=${queueUrl} messageId=${sendResult.MessageId ?? ""}`);
    }

    return {
      success: true,
      queued: true,
      requestId,
      status: "pending",
      message: "check out request has been queued for processing. you will receive an update once the request is processed."
    };
  }

  async getCheckoutGateStatus(email: string, requestId: string) {
    const gate = await getCheckoutGateRequestById(requestId);
    if (!gate || gate.customerEmail !== email) {
      throw new NotFoundException("Checkout request not found.");
    }

    return {
      requestId: gate.requestId,
      status: gate.status,
      message: gate.message || "",
      failureCode: gate.failureCode || "",
      paymentUrl: gate.paymentUrl || "",
      lockedUntil: gate.lockedUntil || "",
      orderId: String((gate as Record<string, unknown>).orderId ?? "").trim()
    };
  }

  async createCheckoutPaymentSession(email: string, requestId: string, ipAddress?: string) {
    const gate = await getCheckoutGateRequestById(requestId);
    if (!gate || gate.customerEmail !== email) {
      throw new NotFoundException("Not found checkout request.");
    }

    if (gate.status !== "allowed") {
      throw new ConflictException("Checkout request is not allowed to proceed to payment.");
    }

    await this.ensureCheckoutGateCanProceedToPayment(gate);

    if (gate.paymentUrl) {
      return {
        requestId: gate.requestId,
        paymentUrl: gate.paymentUrl,
        lockedUntil: gate.lockedUntil || "",
        message: gate.message || ""
      };
    }

    const firstProduct = await getStorefrontProductById(String(gate.items[0]?.productId ?? ""));
    const payment = await this.vnpayService.createWorkflowPaymentUrl({
      email,
      items: gate.items,
      orderId: gate.requestId,
      orderDescription: firstProduct
        ? `Payment for ${firstProduct.name} - ${gate.requestId}`
        : `Payment for reserved items ${gate.requestId}`,
      bankCode: gate.bankCode,
      locale: gate.locale,
      ipAddress,
      expiresAt: gate.lockedUntil
    });

    await updateCheckoutGateRequestStatus({
      requestId: gate.requestId,
      expectedStatus: "allowed",
      status: "allowed",
      message: "Redirecting to VNPay payment gateway.",
      paymentUrl: payment.paymentUrl,
      lockedUntil: gate.lockedUntil || payment.expiresAt
    });

    return {
      requestId: gate.requestId,
      paymentUrl: payment.paymentUrl,
      lockedUntil: gate.lockedUntil || payment.expiresAt,
      message: "Redirecting to VNPay payment gateway."
    };
  }

  async cancelCheckout(email: string, requestId: string) {
    const gate = await getCheckoutGateRequestById(requestId);
    if (!gate || gate.customerEmail !== email) {
      throw new NotFoundException("Not found checkout request.");
    }

    if (gate.status === "blocked") {
      return {
        success: true,
        released: false,
        requestId,
        message: gate.message || "This checkout attempt was already released."
      };
    }

    await releaseCheckoutGateReservation({
      requestId,
      message: "Previous checkout attempt was cancelled after returning from payment.",
      failureCode: "checkout_abandoned"
    });
    return {
      success: true,
      released: true,
      requestId,
      message: "Released previous checkout attempt."
    };
  }

  async createOrder(email: string, input: CreateStorefrontOrderInput) {
    if (!env.EVENTBRIDGE_COMMERCE_BUS_NAME) {
      this.logger.warn(`[eventbridge-commerce] disabled customer=${email}`);
      throw new Error("Queue processing is not enabled. Cannot create order at this time.");
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
      message: "Your order has been queued for processing. You will receive an update once the order is processed."
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
    options?: { queueName?: string; workerName?: string; batchId?: string }
  ) {
    const processedItems: unknown[] = [];
    const failedMessageIds: string[] = [];

    for (const [recordIndex, record] of records.entries()) {
      const messageId = String(record.messageId ?? "");
      this.logger.log(`[checkout-fifo] processing_started batchId=${options?.batchId ?? ""} recordIndex=${recordIndex} messageId=${messageId}`);
      try {
        const item = await this.processCheckoutGateRecord(record.body, {
          batchId: options?.batchId,
          recordIndex
        });
        if (item) {
          processedItems.push(item);
        }
      } catch (error) {
        failedMessageIds.push(messageId);
        const reason = error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error ?? "unknown") };
        this.logger.error(JSON.stringify({
          scope: "queue",
          kind: "error",
          queue: "checkoutGate",
          status: "record_failed",
          messageId,
          reason
        }));
      }

      this.logger.log(`[checkout-fifo] processing_finished batchId=${options?.batchId ?? ""} recordIndex=${recordIndex} messageId=${messageId}`);
    }

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

  private async processCheckoutGateRecord(body: string | undefined, options?: {
    batchId?: string;
    recordIndex?: number;
  }) {
    if (!body) {
      logQueueWarn(this.logger, {
        queue: "checkoutGate",
        status: "record_empty"
      });
      return null;
    }

    const payload = this.parseCheckoutGatePayload(body);
    if (!payload) {
      logQueueWarn(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "ignored_payload"
      });
      return null;
    }

    return this.resolveCheckoutGate(payload, options);
  }

  private parseCheckoutGatePayload(body: string | undefined): CheckoutGateQueuePayload | null {
    if (!body) {
      return null;
    }

    try {
      const payload = unwrapEventBridgeDetail(JSON.parse(body) as Record<string, unknown>) as Partial<CheckoutGateQueuePayload>;
      if (payload.type !== "storefront.checkout.gate.requested" || !payload.email || !payload.requestId || !Array.isArray(payload.items) || payload.items.length === 0) {
        return null;
      }

      return payload as CheckoutGateQueuePayload;
    } catch {
      return null;
    }
  }

  private async resolveCheckoutGate(payload: CheckoutGateQueuePayload, options?: {
    batchId?: string;
    recordIndex?: number;
  }) {
    const normalizedItems = normalizeOrderItems(payload.items);

    try {
        if (env.CHECKOUT_TX_RACE_LOGGING && payload.raceTestId) {
        const participants = await arriveAtCheckoutRaceBarrier({
          raceTestId: payload.raceTestId,
          requestId: payload.requestId
        });
        this.logger.log(JSON.stringify({
          marker: "CHECKOUT_TX_RACE",
          phase: "barrier_arrived",
          batchId: options?.batchId ?? "",
          recordIndex: options?.recordIndex,
          raceTestId: payload.raceTestId,
          requestId: payload.requestId,
          participantCount: participants.size
        }));

        const releasedParticipants = await waitForCheckoutRaceBarrier({
          raceTestId: payload.raceTestId,
          expectedParticipants: 2,
          timeoutMs: 5_000
        });
        this.logger.log(JSON.stringify({
          marker: "CHECKOUT_TX_RACE",
          phase: "barrier_released",
          batchId: options?.batchId ?? "",
          recordIndex: options?.recordIndex,
          raceTestId: payload.raceTestId,
          requestId: payload.requestId,
          participantCount: releasedParticipants.size
        }));
      }

      const reservation = await createCheckoutReservations({
        requestId: payload.requestId,
        email: payload.email,
        items: normalizedItems,
        holdSeconds: 5 * 60,
        trace: {
          batchId: options?.batchId,
          recordIndex: options?.recordIndex,
          enabled: env.CHECKOUT_TX_RACE_LOGGING && Boolean(payload.raceTestId)
        }
      });
      await updateCheckoutGateRequestStatus({
        requestId: payload.requestId,
        expectedStatus: "pending",
        status: "allowed",
        message: "your bucket is held temporarily. you can proceed to payment.",
        lockedUntil: reservation.expiresAt
      });

      logQueueBusinessEvent(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "allowed",
        requestId: payload.requestId,
        details: {
          itemCount: normalizedItems.length,
          productIds: normalizedItems.map((item) => item.productId),
          lockedUntil: reservation.expiresAt
        }
      });

      return {
        requestId: payload.requestId,
        status: "allowed"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to hold product inventory at this time.";
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
        requestId: payload.requestId,
        message,
        details: {
          itemCount: normalizedItems.length,
          productIds: normalizedItems.map((item) => item.productId)
        }
      });

      logQueueWarn(this.logger, {
        queue: "checkoutGate",
        eventType: "storefront.checkout.gate.requested",
        status: "inventory_gate_blocked_reason",
        requestId: payload.requestId,
        message,
        productId: normalizedItems[0]?.productId,
        details: {
          itemCount: normalizedItems.length,
          productIds: normalizedItems.map((item) => item.productId)
        }
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
      this.logger.log(`[dynamo-order] created orderId=${order.id} requestId=${requestId ?? ""} customer=${email} status=${order.status} totalAmount=${order.totalAmount} itemCount=${order.items.length}`);
      await this.publishInventoryAlertsFromOrder(stockChanges, email);

      await this.notificationsService.createPendingNotification({
        email,
        channel: "system",
        title: "order is queued for processing",
        message: `order ${order.id} has been added to the processing queue.`,
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
        title: "Email confirmation is pending",
        message: `The system has queued the confirmation email for order ${order.id}. The order will be marked as done once the email is sent.`,
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
        const failureReason = "Payment is failed due to insufficient stock for one or more items in your order. Please review your cart and try again.";
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
          title: "Payment Failed",
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
    }
  }

  private async ensureCheckoutGateCanProceedToPayment(gate: NonNullable<Awaited<ReturnType<typeof getCheckoutGateRequestById>>>) {
    const lockedUntilMs = new Date(String(gate.lockedUntil ?? "")).getTime();
    if (!Number.isFinite(lockedUntilMs) || lockedUntilMs <= Date.now()) {
      await releaseCheckoutGateReservation({
        requestId: gate.requestId,
        message: "Checkout reservation expired before payment could start.",
        failureCode: "checkout_reservation_expired"
      });
      throw new ConflictException("Checkout reservation expired. Please start checkout again.");
    }

    const reservations = (await listCheckoutReservationsByRequestId(gate.requestId))
      .filter((reservation) => reservation.status === "reserved");
    const reservationByProductId = new Map(reservations.map((reservation) => [reservation.productId, reservation]));

    for (const item of normalizeOrderItems(gate.items)) {
      const reservation = reservationByProductId.get(item.productId);
      if (!reservation || Number(reservation.quantity ?? 0) < item.quantity) {
        await releaseCheckoutGateReservation({
          requestId: gate.requestId,
          message: "Checkout reservation is no longer available.",
          failureCode: "checkout_reservation_lost"
        });
        throw new ConflictException("Checkout reservation is no longer available. Please start checkout again.");
      }

      const product = await getStorefrontProductById(item.productId);
      const stock = Number(product?.stock ?? 0);
      const reservedStock = Number(product?.reservedStock ?? 0);
      if (!product || stock < item.quantity || reservedStock < item.quantity) {
        await releaseCheckoutGateReservation({
          requestId: gate.requestId,
          message: "Product stock changed before payment could start.",
          failureCode: "checkout_stock_changed"
        });
        throw new ConflictException("Product stock changed before payment could start. Please review your cart.");
      }
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
