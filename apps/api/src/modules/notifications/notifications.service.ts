import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env.js";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import { publishAdminAlert } from "../../integrations/sns/publisher.js";
import { sendPaymentFailureEmail } from "../../integrations/ses/order-mailer.js";
import { getOrderById, markOrderAsDone } from "../storefront/storefront.repository.js";
import {
  createNotification,
  deleteNotification,
  deleteNotifications,
  listAllNotifications,
  listNotificationsByCustomer,
  markNotificationAsRead,
  markNotificationAsSent,
  type NotificationRecord
} from "./notifications.repository.js";

function unwrapEventBridgeDetail<T extends Record<string, unknown>>(payload: T): T {
  const detail = payload.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as T
    : payload;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  private async publishAdminAlertSafely(input: {
    subject: string;
    message: string;
    attributes?: Record<string, string | number | boolean | undefined>;
    logContext: string;
  }) {
    if (!env.SNS_ADMIN_ALERTS_TOPIC_ARN) {
      this.logger.warn(`[sns-admin-alert] skipped reason=missing_topic ${input.logContext}`);
      return { queued: false };
    }

    try {
      const published = await publishAdminAlert({
        subject: input.subject,
        message: input.message,
        attributes: input.attributes
      });
      this.logger.log(`[sns-admin-alert] published topic=${published.topicArn} messageId=${published.messageId} ${input.logContext}`);
      return { queued: true, messageId: published.messageId };
    } catch (error) {
      this.logger.warn(`[sns-admin-alert] failed error=${error instanceof Error ? error.message : "unknown"} ${input.logContext}`);
      return { queued: false };
    }
  }

  async createPendingNotification(input: {
    email: string;
    title: string;
    message: string;
    channel: "email" | "system";
    metadata?: Record<string, unknown>;
  }) {
    if (input.channel === "email") {
      this.logger.log(`[queue-notification] skipped channel=email email=${input.email}`);
      return null;
    }

    const notification = await createNotification({
      ...input,
      status: "pending"
    });

    this.logger.log(`[dynamo-notification] created id=${notification.id} channel=${notification.channel} email=${notification.customerEmail}`);
    await this.publishNotificationEvent(notification);
    return notification;
  }

  async publishAuditLog(input: {
    eventType: string;
    email?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) {
      this.logger.warn(`[eventbridge-platform] audit_disabled eventType=${input.eventType} resourceId=${input.resourceId ?? ""}`);
      return { queued: false };
    }

    const detail = {
      type: "audit.log.created",
      eventType: input.eventType,
      email: input.email ?? "",
      resourceId: input.resourceId ?? "",
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
      source: "supermarket.platform",
      detailType: "audit.log.created",
      detail
    });

    this.logger.log(`[eventbridge-platform] audit_published eventType=${input.eventType} resourceId=${input.resourceId ?? ""} bus=${published.eventBusName} eventId=${published.eventId}`);
    return { queued: true, eventId: published.eventId };
  }

  async publishPaymentCompletedEvent(input: {
    email: string;
    txnRef: string;
    amount: number;
    orderInfo: string;
    orderId?: string;
    responseCode: string;
    transactionNo: string;
    bankCode: string;
    payDate: string;
    forceFail?: boolean;
  }) {
    if (!env.EVENTBRIDGE_PAYMENT_BUS_NAME) {
      this.logger.warn(`[eventbridge-payment] success_disabled txnRef=${input.txnRef}`);
      return { queued: false };
    }

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PAYMENT_BUS_NAME,
      source: "supermarket.payment",
      detailType: "payments.vnpay.completed",
      detail: {
        type: "payment.completed",
        email: input.email,
        txnRef: input.txnRef,
        amount: input.amount,
        orderInfo: input.orderInfo,
        orderId: input.orderId ?? "",
        responseCode: input.responseCode,
        transactionNo: input.transactionNo,
        bankCode: input.bankCode,
        payDate: input.payDate,
        forceFail: Boolean(input.forceFail),
        createdAt: new Date().toISOString()
      }
    });

    this.logger.log(`[eventbridge-payment] success_published txnRef=${input.txnRef} bus=${published.eventBusName} eventId=${published.eventId}`);
    return { queued: true, eventId: published.eventId };
  }

  async publishPaymentFailedEvent(input: {
    email: string;
    txnRef: string;
    amount: number;
    orderInfo: string;
    orderId?: string;
    responseCode: string;
    transactionNo: string;
    bankCode: string;
    payDate: string;
    failureReason: string;
    forceFail?: boolean;
  }) {
    if (!env.EVENTBRIDGE_PAYMENT_BUS_NAME) {
      this.logger.warn(`[eventbridge-payment] failed_disabled txnRef=${input.txnRef}`);
      return { queued: false };
    }

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PAYMENT_BUS_NAME,
      source: "supermarket.payment",
      detailType: "payments.vnpay.failed",
      detail: {
        type: "payment.failed",
        email: input.email,
        txnRef: input.txnRef,
        amount: input.amount,
        orderInfo: input.orderInfo,
        orderId: input.orderId ?? "",
        responseCode: input.responseCode,
        transactionNo: input.transactionNo,
        bankCode: input.bankCode,
        payDate: input.payDate,
        failureReason: input.failureReason,
        forceFail: Boolean(input.forceFail),
        createdAt: new Date().toISOString()
      }
    });

    this.logger.log(`[eventbridge-payment] failed_published txnRef=${input.txnRef} responseCode=${input.responseCode} bus=${published.eventBusName} eventId=${published.eventId}`);
    return { queued: true, eventId: published.eventId };
  }

  async publishInventoryStockAlert(input: {
    productId: string;
    productName: string;
    sku?: string;
    stock: number;
    previousStock?: number;
    status: string;
    previousStatus?: string;
    source: "admin.update" | "admin.increment" | "storefront.order";
    changedBy?: string;
  }) {
    if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) {
      this.logger.warn(`[eventbridge-platform] inventory_alert_disabled productId=${input.productId} status=${input.status}`);
      return { queued: false };
    }

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
      source: "supermarket.inventory",
      detailType: "inventory.stock.alert",
      detail: {
        type: "inventory.stock.alert",
        alertLevel: input.status,
        productId: input.productId,
        productName: input.productName,
        sku: input.sku ?? "",
        stock: input.stock,
        previousStock: input.previousStock ?? null,
        status: input.status,
        previousStatus: input.previousStatus ?? "",
        source: input.source,
        changedBy: input.changedBy ?? "",
        createdAt: new Date().toISOString()
      }
    });

    this.logger.log(`[eventbridge-platform] inventory_alert_published productId=${input.productId} status=${input.status} bus=${published.eventBusName} eventId=${published.eventId}`);
    return { queued: true, eventId: published.eventId };
  }

  async listForCustomer(email: string) {
    const items = await listNotificationsByCustomer(email);
    return {
      items,
      pendingCount: items.filter((item) => !item.isRead).length
    };
  }

  async listForPrincipal(input: { email: string; role: "admin" | "customer" | "viewer" }) {
    if (input.role !== "admin") {
      return this.listForCustomer(input.email);
    }

    const items = await listAllNotifications();
    const adminEmails = new Set([input.email, String(env.ADMIN_REPORT_EMAIL ?? "").trim().toLowerCase()].filter(Boolean));
    const adminItems = items.filter((item) => {
      const audience = String(item.metadata?.audience ?? "").trim().toLowerCase();
      return audience === "admin" || adminEmails.has(String(item.customerEmail ?? "").trim().toLowerCase());
    });

    return {
      items: adminItems,
      pendingCount: adminItems.filter((item) => !item.isRead).length
    };
  }

  async markAsRead(email: string, id: string) {
    const notifications = await listNotificationsByCustomer(email);
    const target = notifications.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Không tìm thấy thông báo");
    }

    await markNotificationAsRead(id);
    return { success: true };
  }

  async markAsReadForPrincipal(input: { email: string; role: "admin" | "customer" | "viewer" }, id: string) {
    if (input.role !== "admin") {
      return this.markAsRead(input.email, id);
    }

    const notifications = await this.listForPrincipal(input);
    const target = notifications.items.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Không tìm thấy thông báo");
    }

    await markNotificationAsRead(id);
    return { success: true };
  }

  async remove(email: string, id: string) {
    const notifications = await listNotificationsByCustomer(email);
    const target = notifications.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Không tìm thấy thông báo");
    }

    await deleteNotification(id);
    return { success: true };
  }

  async removeForPrincipal(input: { email: string; role: "admin" | "customer" | "viewer" }, id: string) {
    if (input.role !== "admin") {
      return this.remove(input.email, id);
    }

    const notifications = await this.listForPrincipal(input);
    const target = notifications.items.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Không tìm thấy thông báo");
    }

    await deleteNotification(id);
    return { success: true };
  }

  async removeAll(email: string) {
    const notifications = await listNotificationsByCustomer(email);
    await deleteNotifications(notifications.map((item) => item.id));
    return { success: true, deletedCount: notifications.length };
  }

  async removeAllForPrincipal(input: { email: string; role: "admin" | "customer" | "viewer" }) {
    if (input.role !== "admin") {
      return this.removeAll(input.email);
    }

    const notifications = await this.listForPrincipal(input);
    await deleteNotifications(notifications.items.map((item) => item.id));
    return { success: true, deletedCount: notifications.items.length };
  }

  async processQueueRecords(records: Array<{ body?: string; messageId?: string }>) {
    this.logger.log(`[queue-notification] batch_received size=${records.length}`);

    const settled = await Promise.allSettled(records.map(async (record) => ({
      messageId: String(record.messageId ?? ""),
      item: await this.processQueueRecord(record.body)
    })));

    const processedItems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ messageId: string; item: unknown }>).value.item)
      .filter(Boolean);

    const failedMessageIds = settled
      .flatMap((result, index) => result.status === "rejected" ? [String(records[index]?.messageId ?? "")] : [])
      .filter(Boolean);

    this.logger.log(`[queue-notification] batch_processed processed=${processedItems.length} failed=${failedMessageIds.length} items=${JSON.stringify(processedItems)}`);

    return {
      processed: processedItems.length,
      failedMessageIds,
      items: processedItems
    };
  }

  private async publishNotificationEvent(notification: NotificationRecord) {
    if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) {
      this.logger.warn(`[eventbridge-platform] notification_disabled notificationId=${notification.id}`);
      return { queued: false };
    }

    const published = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
      source: "supermarket.platform",
      detailType: "notifications.pending",
      detail: {
        type: "notification.pending",
        channel: notification.channel,
        email: notification.customerEmail,
        notificationId: notification.id,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata ?? {},
        createdAt: notification.createdAt
      }
    });

    this.logger.log(`[eventbridge-platform] notification_published notificationId=${notification.id} channel=${notification.channel} bus=${published.eventBusName} eventId=${published.eventId}`);
    return { queued: true, eventId: published.eventId };
  }

  private async processQueueRecord(body: string | undefined) {
    if (!body) {
      this.logger.warn("[queue-notification] record_empty");
      return null;
    }

    const payload = unwrapEventBridgeDetail(JSON.parse(body) as Record<string, unknown>) as {
      type?: string;
      email?: string;
      txnRef?: string;
      amount?: number;
      orderInfo?: string;
      orderId?: string;
      responseCode?: string;
      transactionNo?: string;
      bankCode?: string;
      payDate?: string;
      forceFail?: boolean;
      notificationId?: string;
      metadata?: Record<string, unknown>;
      failureReason?: string;
      alertLevel?: string;
      productId?: string;
      productName?: string;
      sku?: string;
      stock?: number;
      previousStock?: number;
      status?: string;
      previousStatus?: string;
      source?: string;
      changedBy?: string;
    };

    if (payload.type === "payment.completed") {
      this.logger.log(`[queue-payment] received type=payment.completed txnRef=${payload.txnRef ?? ""} orderId=${payload.orderId ?? ""}`);
      return this.processPaymentCompletedEvent(payload);
    }

    if (payload.type === "payment.failed") {
      this.logger.log(`[queue-payment] received type=payment.failed txnRef=${payload.txnRef ?? ""} orderId=${payload.orderId ?? ""}`);
      return this.processPaymentFailedEvent(payload);
    }

    if (payload.type === "inventory.stock.alert") {
      this.logger.log(`[queue-admin-alert] received type=inventory.stock.alert productId=${payload.productId ?? ""} level=${payload.alertLevel ?? ""}`);
      return this.processInventoryStockAlert(payload);
    }

    if (payload.type !== "notification.pending" || !payload.notificationId) {
      this.logger.warn(`[queue-notification] ignored payload=${body}`);
      return null;
    }

    this.logger.log(`[queue-notification] received type=notification.pending notificationId=${payload.notificationId} channel=${String((payload as { channel?: string }).channel ?? "")}`);
    this.logger.log(`[queue-notification] processing notificationId=${payload.notificationId} orderId=${String(payload.metadata?.orderId ?? "")}`);
    await markNotificationAsSent(payload.notificationId);

    const orderId = String(payload.metadata?.orderId ?? "").trim();
    if (!orderId) {
      this.logger.log(`[queue-notification] completed notificationId=${payload.notificationId} orderCompleted=false`);
      return {
        type: "notification.pending",
        notificationId: payload.notificationId,
        orderId,
        orderCompleted: false
      };
    }

    await this.completeOrderIfReady(orderId);
    this.logger.log(`[queue-notification] completed notificationId=${payload.notificationId} orderId=${orderId} orderCompleted=true`);
    return {
      type: "notification.pending",
      notificationId: payload.notificationId,
      orderId,
      orderCompleted: true
    };
  }

  private async processPaymentCompletedEvent(payload: {
    email?: string;
    txnRef?: string;
    amount?: number;
    orderInfo?: string;
    orderId?: string;
    responseCode?: string;
    transactionNo?: string;
    bankCode?: string;
    payDate?: string;
    forceFail?: boolean;
    failureReason?: string;
  }) {
    if (!payload.email || !payload.txnRef) {
      this.logger.warn(`[queue-payment] ignored txnRef=${payload.txnRef ?? ""}`);
      return null;
    }

    const email = payload.email.trim().toLowerCase();
    const orderId = payload.orderId?.trim() || "";
    const amount = Number(payload.amount ?? 0);

    this.logger.log(`[queue-payment] success_processing txnRef=${payload.txnRef} orderId=${orderId}`);

    if (payload.forceFail) {
      this.logger.error(`[queue-payment] success_force_fail txnRef=${payload.txnRef}`);
      throw new Error(`Forced failure for payment txnRef=${payload.txnRef}`);
    }

    await this.createPendingNotification({
      email,
      channel: "system",
      title: "Thanh toán thành công",
      message: `Giao dịch ${payload.txnRef} đã được xác nhận thanh toán thành công.`,
      metadata: {
        orderId,
        txnRef: payload.txnRef,
        amount,
        orderInfo: payload.orderInfo ?? "",
        paymentStatus: "success"
      }
    });

    await this.publishAuditLog({
      eventType: "payments.vnpay.completed",
      email,
      resourceId: payload.txnRef,
      metadata: {
        orderId,
        amount,
        orderInfo: payload.orderInfo ?? "",
        responseCode: payload.responseCode ?? "",
        transactionNo: payload.transactionNo ?? "",
        bankCode: payload.bankCode ?? "",
        payDate: payload.payDate ?? "",
        status: "success"
      }
    });

    this.logger.log(`[queue-payment] success_completed txnRef=${payload.txnRef} orderId=${orderId}`);
    return {
      type: "payment.completed",
      txnRef: payload.txnRef,
      orderId,
      queuedNotifications: 1,
      auditQueued: true
    };
  }

  private async processPaymentFailedEvent(payload: {
    email?: string;
    txnRef?: string;
    amount?: number;
    orderInfo?: string;
    orderId?: string;
    responseCode?: string;
    transactionNo?: string;
    bankCode?: string;
    payDate?: string;
    failureReason?: string;
    forceFail?: boolean;
  }) {
    if (!payload.email || !payload.txnRef) {
      this.logger.warn(`[queue-payment] failed_ignored txnRef=${payload.txnRef ?? ""}`);
      return null;
    }

    const email = payload.email.trim().toLowerCase();
    const orderId = payload.orderId?.trim() || "";
    const amount = Number(payload.amount ?? 0);
    const failureReason = String(payload.failureReason ?? "payment_failed");

    this.logger.log(`[queue-payment] failed_processing txnRef=${payload.txnRef} orderId=${orderId} responseCode=${payload.responseCode ?? ""}`);

    if (payload.forceFail) {
      this.logger.error(`[queue-payment] failed_force_fail txnRef=${payload.txnRef}`);
      throw new Error(`Forced failure for failed-payment txnRef=${payload.txnRef}`);
    }

    try {
      await sendPaymentFailureEmail({
        toEmail: email,
        txnRef: payload.txnRef,
        totalAmount: amount,
        orderInfo: payload.orderInfo ?? "",
        failureReason,
        responseCode: payload.responseCode,
        bankCode: payload.bankCode,
        payDate: payload.payDate
      });
      this.logger.log(`[mail-ses] payment_failed_sent txnRef=${payload.txnRef} to=${email}`);
    } catch (error) {
      this.logger.warn(
        `[mail-ses] payment_failed_failed txnRef=${payload.txnRef} to=${email} error=${error instanceof Error ? error.message : "unknown"}`
      );
    }

    await this.createPendingNotification({
      email,
      channel: "system",
      title: "Thanh toán không thành công",
      message: `Giao dịch ${payload.txnRef} không hoàn tất. Lý do: ${failureReason}.`,
      metadata: {
        orderId,
        txnRef: payload.txnRef,
        amount,
        orderInfo: payload.orderInfo ?? "",
        paymentStatus: "failed",
        responseCode: payload.responseCode ?? "",
        failureReason
      }
    });

    await this.publishAuditLog({
      eventType: "payments.vnpay.failed",
      email,
      resourceId: payload.txnRef,
      metadata: {
        orderId,
        amount,
        orderInfo: payload.orderInfo ?? "",
        responseCode: payload.responseCode ?? "",
        transactionNo: payload.transactionNo ?? "",
        bankCode: payload.bankCode ?? "",
        payDate: payload.payDate ?? "",
        status: "failed",
        failureReason
      }
    });

    await this.publishAdminAlertSafely({
      subject: `Cảnh báo thanh toán thất bại ${payload.txnRef}`,
      message: [
        "Thanh toán thất bại đã được ghi nhận.",
        `TxnRef: ${payload.txnRef}`,
        `Khách hàng: ${email}`,
        `Số tiền: ${amount}`,
        `Lý do: ${failureReason}`,
        `ResponseCode: ${payload.responseCode ?? ""}`,
        `OrderId: ${orderId || "N/A"}`
      ].join("\n"),
      attributes: {
        alertType: "payment.failed",
        txnRef: payload.txnRef,
        orderId,
        responseCode: payload.responseCode ?? "",
        customerEmail: email
      },
      logContext: `alertType=payment.failed txnRef=${payload.txnRef} orderId=${orderId}`
    });

    this.logger.log(`[queue-payment] failed_completed txnRef=${payload.txnRef} orderId=${orderId}`);
    return {
      type: "payment.failed",
      txnRef: payload.txnRef,
      orderId,
      queuedNotifications: 1,
      auditQueued: true,
      failureReason
    };
  }

  private async completeOrderIfReady(orderId: string) {
    const order = await getOrderById(orderId);
    if (!order || order.status === "done") {
      return;
    }

    const notifications = await listNotificationsByCustomer(order.customerEmail);
    const orderNotifications = notifications.filter((item) => String(item.metadata?.orderId ?? "") === orderId);
    const systemSent = orderNotifications.some((item) => item.channel === "system" && item.status === "sent");

    if (!systemSent) {
      this.logger.log(`[dynamo-order] pending orderId=${orderId} systemSent=${systemSent}`);
      return;
    }

    await markOrderAsDone(orderId);
    this.logger.log(`[dynamo-order] done orderId=${orderId}`);
  }

  private async processInventoryStockAlert(payload: {
    alertLevel?: string;
    productId?: string;
    productName?: string;
    sku?: string;
    stock?: number;
    previousStock?: number;
    status?: string;
    previousStatus?: string;
    source?: string;
    changedBy?: string;
  }) {
    if (!env.ADMIN_REPORT_EMAIL || !payload.productId || !payload.productName) {
      this.logger.warn(`[queue-admin-alert] skipped productId=${payload.productId ?? ""} reason=missing_admin_email_or_product`);
      return null;
    }

    const stock = Number(payload.stock ?? 0);
    const level = String(payload.alertLevel ?? payload.status ?? "").trim();
    const source = String(payload.source ?? "").trim();
    const changedBy = String(payload.changedBy ?? "").trim();
    const title = level === "out_of_stock"
      ? "Sản phẩm đã hết hàng"
      : "Sản phẩm sắp hết hàng";
    const message = level === "out_of_stock"
      ? `${payload.productName} đã hết hàng. Số lượng hiện tại: ${stock}.`
      : `${payload.productName} đang ở mức tồn kho thấp. Số lượng hiện tại: ${stock}.`;

    const notification = await this.createPendingNotification({
      email: env.ADMIN_REPORT_EMAIL,
      channel: "system",
      title,
      message,
      metadata: {
        audience: "admin",
        alertType: "inventory.stock.alert",
        alertLevel: level,
        productId: payload.productId,
        productName: payload.productName,
        sku: payload.sku ?? "",
        stock,
        previousStock: Number(payload.previousStock ?? 0),
        status: payload.status ?? level,
        previousStatus: payload.previousStatus ?? "",
        source,
        changedBy
      }
    });

    await this.publishAuditLog({
      eventType: "inventory.stock.alerted",
      email: env.ADMIN_REPORT_EMAIL,
      resourceId: payload.productId,
      metadata: {
        alertLevel: level,
        productName: payload.productName,
        sku: payload.sku ?? "",
        stock,
        previousStock: Number(payload.previousStock ?? 0),
        source,
        changedBy
      }
    });

    await this.publishAdminAlertSafely({
      subject: level === "out_of_stock" ? `Hết hàng: ${payload.productName}` : `Sắp hết hàng: ${payload.productName}`,
      message: [
        "Cảnh báo tồn kho dành cho admin.",
        `Sản phẩm: ${payload.productName}`,
        `ProductId: ${payload.productId}`,
        `SKU: ${payload.sku ?? "N/A"}`,
        `Mức cảnh báo: ${level}`,
        `Tồn kho hiện tại: ${stock}`,
        `ồn kho trước đó: ${Number(payload.previousStock ?? 0)}`,
        `Nguồn thay đổi: ${source || "unknown"}`,
        `Người thay đổi: ${changedBy || "unknown"}`
      ].join("\n"),
      attributes: {
        alertType: "inventory.stock.alert",
        alertLevel: level,
        productId: payload.productId,
        sku: payload.sku ?? "",
        stock
      },
      logContext: `alertType=inventory.stock.alert productId=${payload.productId} level=${level}`
    });

    return {
      type: "inventory.stock.alert",
      productId: payload.productId,
      alertLevel: level,
      notificationId: notification?.id ?? "",
      adminEmail: env.ADMIN_REPORT_EMAIL
    };
  }
}
