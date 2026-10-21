import { GetCheckoutStatus } from "./application/get-checkout-status/get-checkout-status.js";
import { FinalizeOrder } from "./application/finalize-order/finalize-order.js";
import { CreateCheckout } from "./application/create-checkout/create-checkout.js";
import { CancelOrder } from "./application/cancel-order/cancel-order.js";
import { RequestRefund } from "./application/request-refund/request-refund.js";
import { RefreshRefundStatus } from "./application/refresh-refund-status/refresh-refund-status.js";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import type { CatalogQuery } from "./application/ports/catalog-reader.js";
import type { StorefrontOrderQueuePayload } from "./storefront.repository.js";
import type { CreateStorefrontOrderInput } from "./storefront.schema.js";
import { GetProduct, ListProducts } from "./application/read-catalog/read-catalog.js";
import { GetOrderDetails, ListMyOrders } from "./application/read-orders/read-orders.js";

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

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    @Inject(CancelOrder) private readonly cancelOrderUseCase: CancelOrder,
    @Inject(RequestRefund) private readonly requestRefundUseCase: RequestRefund,
    @Inject(RefreshRefundStatus) private readonly refreshRefundUseCase: RefreshRefundStatus,
    @Inject(CreateCheckout) private readonly createCheckout: CreateCheckout,
    @Inject(FinalizeOrder) private readonly finalizeOrder: FinalizeOrder,
    @Inject(GetCheckoutStatus) private readonly checkoutStatus: GetCheckoutStatus,
    @Inject(GetProduct) private readonly getProduct: GetProduct,
    @Inject(ListProducts) private readonly browseProducts: ListProducts,
    @Inject(GetOrderDetails) private readonly orderDetails: GetOrderDetails,
    @Inject(ListMyOrders) private readonly myOrders: ListMyOrders
  ) {}

  listProducts(query: CatalogQuery) {
    return this.browseProducts.execute(query);
  }

  getProductById(id: string) { return this.getProduct.execute(id); }

  getOrderStatus(email: string, orderId: string) { return this.checkoutStatus.execute(email, orderId); }

  getOrderDetails(email: string, orderId: string) { return this.orderDetails.execute(email, orderId); }

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
    return this.myOrders.execute(email);
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
