export type OrderConfirmationInput = {
  toEmail: string;
  orderId: string;
  customerName?: string;
  totalAmount: number;
  createdAt: string;
  paymentConfirmedAt?: string;
  orderUrl?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    originalUnitPrice?: number;
    lineTotal: number;
  }>;
};

function money(value: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function originalUnitPrice(item: OrderConfirmationInput["items"][number]) {
  return typeof item.originalUnitPrice === "number" && Number.isFinite(item.originalUnitPrice)
    && item.originalUnitPrice > item.unitPrice
    ? item.originalUnitPrice
    : undefined;
}

export function orderConfirmationContent(input: OrderConfirmationInput) {
  const paid = Boolean(input.paymentConfirmedAt);
  const subject = paid
    ? "Thanh toán thành công | NovaX Market"
    : "Đơn hàng đã được ghi nhận | NovaX Market";
  const customerName = input.customerName?.trim() || input.toEmail;
  const eventLabel = paid ? "Xác nhận thanh toán" : "Đặt hàng";
  const eventTime = dateTime(input.paymentConfirmedAt || input.createdAt);
  const originalTotal = input.items.every((item) => typeof item.originalUnitPrice === "number")
    ? input.items.reduce((sum, item) => sum + Math.max(item.unitPrice, item.originalUnitPrice!) * item.quantity, 0)
    : undefined;
  const savings = originalTotal !== undefined && originalTotal > input.totalAmount
    ? originalTotal - input.totalAmount
    : 0;

  const rows = input.items.map((item) => {
    const original = originalUnitPrice(item);
    return `<tr>
      <td style="padding:14px 8px 14px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;">${escapeHtml(item.productName)}</td>
      <td style="padding:14px 8px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center;">${item.quantity}</td>
      <td style="padding:14px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;">
        ${original ? `<span style="display:block;color:#94a3b8;text-decoration:line-through;font-size:12px;">${escapeHtml(money(original))}</span>` : ""}
        <span style="color:#0f172a;">${escapeHtml(money(item.unitPrice))}</span>
      </td>
      <td style="padding:14px 0 14px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;white-space:nowrap;">${escapeHtml(money(item.lineTotal))}</td>
    </tr>`;
  }).join("");

  const html = `<div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
      <div style="padding:28px 32px;background:#ea580c;color:#ffffff;">
        <div style="font-size:13px;font-weight:700;letter-spacing:0.12em;">NovaX Market</div>
        <h1 style="margin:10px 0 0;font-size:25px;line-height:1.35;">${paid ? "Thanh toán thành công" : "Đơn hàng đã được ghi nhận"}</h1>
      </div>
      <div style="padding:28px 32px;">
        <p style="margin:0 0 8px;font-size:16px;line-height:1.6;">Xin chào <strong>${escapeHtml(customerName)}</strong>,</p>
        <p style="margin:0 0 22px;color:#475569;line-height:1.6;">${paid
          ? "Cảm ơn bạn đã thanh toán. Dưới đây là những sản phẩm bạn đã mua."
          : "Đơn hàng của bạn đã được ghi nhận. Dưới đây là những sản phẩm bạn đã đặt."}</p>
        <div style="padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;color:#9a3412;font-size:14px;">
          ${eventLabel}: <strong>${escapeHtml(eventTime)}</strong>
        </div>
        <table style="width:100%;margin-top:24px;border-collapse:collapse;font-size:14px;">
          <thead><tr>
            <th style="padding:0 8px 10px 0;text-align:left;color:#64748b;">Sản phẩm</th>
            <th style="padding:0 8px 10px;text-align:center;color:#64748b;">SL</th>
            <th style="padding:0 8px 10px;text-align:right;color:#64748b;">Đơn giá</th>
            <th style="padding:0 0 10px 8px;text-align:right;color:#64748b;">Thành tiền</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:20px;text-align:right;">
          ${savings ? `<div style="color:#64748b;font-size:14px;">Giá trước giảm: ${escapeHtml(money(originalTotal!))}</div>
            <div style="margin-top:6px;color:#15803d;font-size:14px;">Đã giảm: -${escapeHtml(money(savings))}</div>` : ""}
          <div style="margin-top:10px;color:#475569;font-size:14px;">${paid ? "Tổng đã thanh toán" : "Tổng giá trị đơn hàng"}</div>
          <div style="margin-top:5px;color:#c2410c;font-size:26px;font-weight:800;">${escapeHtml(money(input.totalAmount))}</div>
        </div>
        <div style="margin-top:28px;padding:10px 12px;background:#f8fafc;border-radius:8px;color:#64748b;font-size:12px;word-break:break-all;">
          Mã đơn hàng để tra cứu/hỗ trợ: ${escapeHtml(input.orderId)}
        </div>
        ${input.orderUrl ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(input.orderUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#ea580c;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Xem chi tiết đơn hàng</a></p>` : ""}
      </div>
    </div>
  </div>`;

  const text = [
    paid ? "Thanh toán thành công - NovaX Market" : "Đơn hàng đã được ghi nhận - NovaX Market",
    `Xin chào ${customerName},`,
    `${eventLabel}: ${eventTime}`,
    "",
    ...input.items.map((item) => {
      const original = originalUnitPrice(item);
      return `${item.productName} x ${item.quantity} — ${original ? `${money(original)} → ` : ""}${money(item.unitPrice)}/sản phẩm — ${money(item.lineTotal)}`;
    }),
    "",
    ...(savings ? [`Giá trước giảm: ${money(originalTotal!)}`, `Đã giảm: -${money(savings)}`] : []),
    `${paid ? "Tổng đã thanh toán" : "Tổng giá trị đơn hàng"}: ${money(input.totalAmount)}`,
    `Mã đơn hàng để tra cứu/hỗ trợ: ${input.orderId}`,
    ...(input.orderUrl ? [`Xem chi tiết đơn hàng: ${input.orderUrl}`] : [])
  ].join("\n");

  return { subject, html, text };
}
