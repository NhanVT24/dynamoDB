import { Injectable, NotFoundException } from "@nestjs/common";
import { NotificationsService } from "../notifications/notifications.service.js";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { createStorefrontOrder, getStorefrontProductById, listOrdersByCustomer, listStorefrontProducts } from "./storefront.repository.js";
import type { CreateStorefrontOrderInput } from "./storefront.schema.js";

@Injectable()
export class StorefrontService {
  constructor(private readonly notificationsService: NotificationsService) {}

  listProducts(rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    return listStorefrontProducts(query);
  }

  async getProductById(id: string) {
    const item = await getStorefrontProductById(id);
    if (!item) throw new NotFoundException("Product not found");
    return item;
  }

  async createOrder(email: string, input: CreateStorefrontOrderInput) {
    const order = await createStorefrontOrder({ email, items: input.items });

    await this.notificationsService.createPendingNotification({
      email,
      channel: "system",
      title: "Đơn hàng đang chờ xử lý",
      message: `Đơn hàng ${order.id} đã được tạo và đang ở trạng thái pending.`,
      metadata: {
        orderId: order.id,
        totalAmount: order.totalAmount,
        itemCount: order.items.length
      }
    });

    await this.notificationsService.createPendingNotification({
      email,
      channel: "email",
      title: "Email xác nhận đơn hàng đang chờ gửi",
      message: `Hệ thống đã xếp hàng email xác nhận cho đơn ${order.id}.`,
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
        status: order.status
      }
    });

    return order;
  }

  listMyOrders(email: string) {
    return listOrdersByCustomer(email);
  }
}
