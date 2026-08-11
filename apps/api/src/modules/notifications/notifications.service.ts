import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { env } from "../../config/env.js";
import { sqsClient } from "../../integrations/sqs/client.js";
import { getOrderById, markOrderAsDone } from "../storefront/storefront.repository.js";
import {
  createNotification,
  deleteNotification,
  listNotificationsByCustomer,
  markNotificationAsRead,
  markNotificationAsSent,
  type NotificationRecord
} from "./notifications.repository.js";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async createPendingNotification(input: {
    email: string;
    title: string;
    message: string;
    channel: "email" | "system";
    metadata?: Record<string, unknown>;
  }) {
    const notification = await createNotification({
      ...input,
      status: "pending"
    });

    this.logger.log(`notification.created id=${notification.id} channel=${notification.channel} email=${notification.customerEmail}`);
    await this.publishNotificationEvent(notification);
    return notification;
  }

  async publishAuditLog(input: {
    eventType: string;
    email?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!env.SQS_AUDIT_QUEUE_URL) {
      this.logger.warn(`audit.queue.disabled eventType=${input.eventType} resourceId=${input.resourceId ?? ""}`);
      return { queued: false };
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: env.SQS_AUDIT_QUEUE_URL,
      MessageBody: JSON.stringify({
        eventType: input.eventType,
        email: input.email ?? "",
        resourceId: input.resourceId ?? "",
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString()
      })
    }));

    this.logger.log(`audit.enqueued eventType=${input.eventType} resourceId=${input.resourceId ?? ""} queue=${env.SQS_AUDIT_QUEUE_URL}`);

    return { queued: true };
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
  }) {
    if (!env.SQS_PAYMENT_EVENTS_QUEUE_URL) {
      this.logger.warn(`payment.queue.disabled txnRef=${input.txnRef}`);
      return { queued: false };
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: env.SQS_PAYMENT_EVENTS_QUEUE_URL,
      MessageBody: JSON.stringify({
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
        createdAt: new Date().toISOString()
      })
    }));

    this.logger.log(`payment.enqueued txnRef=${input.txnRef} queue=${env.SQS_PAYMENT_EVENTS_QUEUE_URL}`);
    return { queued: true };
  }

  async listForCustomer(email: string) {
    const items = await listNotificationsByCustomer(email);
    return {
      items,
      pendingCount: items.filter((item) => !item.isRead).length
    };
  }

  async markAsRead(email: string, id: string) {
    const notifications = await listNotificationsByCustomer(email);
    const target = notifications.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Notification not found");
    }

    await markNotificationAsRead(id);
    return { success: true };
  }

  async remove(email: string, id: string) {
    const notifications = await listNotificationsByCustomer(email);
    const target = notifications.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException("Notification not found");
    }

    await deleteNotification(id);
    return { success: true };
  }

  async processQueueRecords(records: Array<{ body?: string }>) {
    this.logger.log(`notification.queue.batch_received size=${records.length}`);
    const results = await Promise.all(records.map((record) => this.processQueueRecord(record.body)));
    this.logger.log(`notification.queue.batch_processed processed=${results.filter(Boolean).length}`);
    return {
      processed: results.filter(Boolean).length
    };
  }

  private async publishNotificationEvent(notification: NotificationRecord) {
    if (!env.SQS_NOTIFICATIONS_QUEUE_URL) {
      this.logger.warn(`notification.queue.disabled notificationId=${notification.id}`);
      return { queued: false };
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: env.SQS_NOTIFICATIONS_QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "notification.pending",
        channel: notification.channel,
        email: notification.customerEmail,
        notificationId: notification.id,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata ?? {},
        createdAt: notification.createdAt
      })
    }));

    this.logger.log(`notification.enqueued notificationId=${notification.id} channel=${notification.channel} queue=${env.SQS_NOTIFICATIONS_QUEUE_URL}`);

    return { queued: true };
  }

  private async processQueueRecord(body: string | undefined) {
    if (!body) {
      return null;
    }

    const payload = JSON.parse(body) as {
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
      notificationId?: string;
      metadata?: Record<string, unknown>;
    };

    if (payload.type === "payment.completed") {
      return this.processPaymentCompletedEvent(payload);
    }

    if (payload.type !== "notification.pending" || !payload.notificationId) {
      this.logger.warn(`notification.queue.ignored payload=${body}`);
      return null;
    }

    this.logger.log(`notification.queue.processing notificationId=${payload.notificationId} orderId=${String(payload.metadata?.orderId ?? "")}`);
    await markNotificationAsSent(payload.notificationId);

    const orderId = String(payload.metadata?.orderId ?? "").trim();
    if (!orderId) {
      this.logger.log(`notification.queue.completed notificationId=${payload.notificationId} orderCompleted=false`);
      return { notificationId: payload.notificationId, orderCompleted: false };
    }

    await this.completeOrderIfReady(orderId);
    this.logger.log(`notification.queue.completed notificationId=${payload.notificationId} orderId=${orderId} orderCompleted=true`);
    return { notificationId: payload.notificationId, orderCompleted: true };
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
  }) {
    if (!payload.email || !payload.txnRef) {
      this.logger.warn(`payment.queue.ignored txnRef=${payload.txnRef ?? ""}`);
      return null;
    }

    const email = payload.email.trim().toLowerCase();
    const orderId = payload.orderId?.trim() || "";
    const amount = Number(payload.amount ?? 0);

    this.logger.log(`payment.queue.processing txnRef=${payload.txnRef} orderId=${orderId}`);

    await this.createPendingNotification({
      email,
      channel: "system",
      title: "Thanh toan thanh cong",
      message: `Giao dich ${payload.txnRef} da duoc xac nhan thanh toan thanh cong.`,
      metadata: {
        orderId,
        txnRef: payload.txnRef,
        amount,
        orderInfo: payload.orderInfo ?? "",
        paymentStatus: "success"
      }
    });

    await this.createPendingNotification({
      email,
      channel: "email",
      title: "Email xac nhan thanh toan dang cho gui",
      message: `He thong da xep hang email xac nhan thanh toan cho giao dich ${payload.txnRef}.`,
      metadata: {
        orderId,
        txnRef: payload.txnRef,
        amount,
        template: "payment-success"
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

    this.logger.log(`payment.queue.completed txnRef=${payload.txnRef} orderId=${orderId}`);
    return { txnRef: payload.txnRef, queuedNotifications: 2, auditQueued: true };
  }

  private async completeOrderIfReady(orderId: string) {
    const order = await getOrderById(orderId);
    if (!order || order.status === "done") {
      return;
    }

    const notifications = await listNotificationsByCustomer(order.customerEmail);
    const orderNotifications = notifications.filter((item) => String(item.metadata?.orderId ?? "") === orderId);
    const systemSent = orderNotifications.some((item) => item.channel === "system" && item.status === "sent");
    const emailSent = orderNotifications.some((item) => item.channel === "email" && item.status === "sent");

    if (!systemSent || !emailSent) {
      this.logger.log(`order.pending orderId=${orderId} systemSent=${systemSent} emailSent=${emailSent}`);
      return;
    }

    await markOrderAsDone(orderId);
    this.logger.log(`order.done orderId=${orderId}`);
  }
}
