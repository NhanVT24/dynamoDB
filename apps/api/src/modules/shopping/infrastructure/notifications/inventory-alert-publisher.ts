import type { NotificationsService } from "../../../notifications/notifications.service.js";
import type { InventoryAlertPublisher, InventoryStockAlert } from "../../application/ports/inventory-alert-publisher.js";

export class NotificationsInventoryAlertPublisher implements InventoryAlertPublisher {
  constructor(private readonly notifications: Pick<NotificationsService, "publishInventoryStockAlert">) {}

  async publish(alert: InventoryStockAlert): Promise<void> {
    await this.notifications.publishInventoryStockAlert(alert);
  }
}
