import type { PaymentEvents, PaymentEvent } from "../application/ports/payment-ports.js";
import type { NotificationsService } from "../../notifications/notifications.service.js";

export class NotificationPaymentEvents implements PaymentEvents {
  constructor(private readonly notifications: NotificationsService) {}
  async publishCompleted(event: PaymentEvent) {
    const result = await this.notifications.publishPaymentCompletedEvent(event);
    if (!result.queued) throw new Error("Payment event publishing is disabled");
  }
  async publishFailed(event: PaymentEvent) {
    const reasons: Record<string, string> = { "24": "Khách hàng đã hủy giao dịch.",
      "51": "Tài khoản không đủ số dư để thanh toán.", "65": "Tài khoản đã vượt quá hạn mức giao dịch trong ngày.",
      "75": "Ngân hàng thanh toán đang bảo trì hoặc không phản hồi.", "00": "VNPay has not confirmed payment success." };
    const result = await this.notifications.publishPaymentFailedEvent({ ...event,
      failureReason: reasons[event.responseCode] ?? "Giao dịch chưa hoàn tất hoặc đã xảy ra lỗi trong quá trình thanh toán." });
    if (!result.queued) throw new Error("Payment event publishing is disabled");
  }
}
