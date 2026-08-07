import { Injectable, NotFoundException } from "@nestjs/common";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { env } from "../../config/env.js";
import { sqsClient } from "../../integrations/sqs/client.js";
import {
  createNotification,
  listNotificationsByCustomer,
  markNotificationAsRead,
  type NotificationRecord
} from "./notifications.repository.js";

@Injectable()
export class NotificationsService {
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

    return { queued: true };
  }

  async listForCustomer(email: string) {
    const items = await listNotificationsByCustomer(email);
    return {
      items,
      pendingCount: items.filter((item) => item.status === "pending").length
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

  private async publishNotificationEvent(notification: NotificationRecord) {
    if (!env.SQS_NOTIFICATIONS_QUEUE_URL) {
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

    return { queued: true };
  }
}
