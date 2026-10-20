import { Logger } from "@nestjs/common";
import type { OrderOperationLogger } from "../application/ports/order-lifecycle-ports.js";

export class NestOrderOperationLogger implements OrderOperationLogger {
  private readonly logger = new Logger("OrderLifecycle");
  warn(event: string, context: Parameters<OrderOperationLogger["warn"]>[1]): void { this.logger.warn(this.entry(event, context)); }
  error(event: string, context: Parameters<OrderOperationLogger["error"]>[1]): void { this.logger.error(this.entry(event, context)); }
  private entry(event: string, context: Parameters<OrderOperationLogger["warn"]>[1]) {
    return { event, orderId: context.orderId, requestId: context.requestId,
      error: context.error instanceof Error ? context.error.message : context.error ? "Unknown error" : undefined };
  }
}
