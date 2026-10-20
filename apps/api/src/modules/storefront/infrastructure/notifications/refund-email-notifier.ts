import { Logger } from "@nestjs/common";
import { sendRefundStatusEmail } from "../../../../integrations/ses/order-mailer.js";
import { ordersSenderEmail } from "../../../../integrations/ses/sender-config.js";
import type { RefundNotifier } from "../../application/ports/order-lifecycle-ports.js";

export class RefundEmailNotifier implements RefundNotifier {
  private readonly logger = new Logger(RefundEmailNotifier.name);

  async send(input: Parameters<RefundNotifier["send"]>[0]): Promise<void> {
    if (!ordersSenderEmail()) {
      this.logger.warn(`[refund-email] skipped orderId=${input.orderId} status=${input.status} reason=ses_not_configured`);
      return;
    }
    // Errors are handled by RefundResolution, separate from provider/persistence.
    await sendRefundStatusEmail({ toEmail: input.email, orderId: input.orderId, totalAmount: input.totalAmount, status: input.status });
    this.logger.log(`[refund-email] sent orderId=${input.orderId} status=${input.status}`);
  }
}
