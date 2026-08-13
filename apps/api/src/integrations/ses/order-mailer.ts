import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "../../config/env.js";
import { sesClient } from "./client.js";

type OrderMailLine = {
  productName: string;
  quantity: number;
  lineTotal: number;
};

type SendOrderConfirmationEmailInput = {
  toEmail: string;
  orderId: string;
  customerName?: string;
  totalAmount: number;
  createdAt: string;
  items: OrderMailLine[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND"
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN", { hour12: false });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildOrderConfirmationHtml(input: SendOrderConfirmationEmailInput) {
  const customerName = input.customerName?.trim() || input.toEmail;
  const rows = input.items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(item.productName)}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center;">${item.quantity}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#ea580c;text-align:right;font-weight:700;">${escapeHtml(formatCurrency(item.lineTotal))}</td>
    </tr>
  `).join("");

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#f97316,#ef4444);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;">NovaX Market</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">Xác nhận đơn hàng thành công</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">Xin chào <strong>${escapeHtml(customerName)}</strong>,</p>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.7;">
            Đơn hàng <strong>#${escapeHtml(input.orderId)}</strong> của bạn đã được hệ thống ghi nhận thành công.
          </p>
          <div style="padding:20px;border-radius:20px;background:#fff7ed;border:1px solid #fdba74;">
            <p style="margin:0 0 8px;font-size:14px;color:#9a3412;">Mã đơn hàng</p>
            <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#7c2d12;">#${escapeHtml(input.orderId)}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#9a3412;">Thời gian tạo đơn</p>
            <p style="margin:0;font-size:16px;font-weight:600;color:#7c2d12;">${escapeHtml(formatDate(input.createdAt))}</p>
          </div>
          <table style="width:100%;margin-top:24px;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:0 0 12px;text-align:left;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Sản phẩm</th>
                <th style="padding:0 0 12px;text-align:center;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">SL</th>
                <th style="padding:0 0 12px;text-align:right;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Thành tiền</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin-top:24px;padding-top:20px;border-top:1px dashed #cbd5e1;text-align:right;">
            <div style="font-size:14px;color:#64748b;">Tổng thanh toán</div>
            <div style="margin-top:8px;font-size:28px;font-weight:800;color:#ea580c;">${escapeHtml(formatCurrency(input.totalAmount))}</div>
          </div>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#475569;">
            Cảm ơn bạn đã mua sắm tại NovaX Market. Nếu cần kiểm tra lại đơn hàng, bạn có thể xem ngay trong lịch sử mua hàng trên hệ thống.
          </p>
        </div>
      </div>
    </div>
  `;
}

export async function sendOrderConfirmationEmail(input: SendOrderConfirmationEmailInput) {
  if (!env.SES_FROM_EMAIL) {
    throw new Error("Thiếu cấu hình SES_FROM_EMAIL.");
  }

  await sesClient.send(new SendEmailCommand({
    FromEmailAddress: env.SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [input.toEmail]
    },
    Content: {
      Simple: {
        Subject: {
          Data: `Xác nhận đơn hàng #${input.orderId} từ NovaX Market`,
          Charset: "UTF-8"
        },
        Body: {
          Html: {
            Data: buildOrderConfirmationHtml(input),
            Charset: "UTF-8"
          }
        }
      }
    }
  }));
}
