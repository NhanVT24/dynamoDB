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

type SendPaymentFailureEmailInput = {
  toEmail: string;
  txnRef: string;
  totalAmount: number;
  orderInfo: string;
  failureReason: string;
  responseCode?: string;
  bankCode?: string;
  payDate?: string;
};

type SendOrderFailureEmailInput = {
  toEmail: string;
  requestId?: string;
  failureReason: string;
  items: Array<{
    productId: string;
    productName?: string;
    quantity: number;
  }>;
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

function assertSesConfigured() {
  if (!env.SES_FROM_EMAIL) {
    throw new Error("Thiếu cấu hình SES_FROM_EMAIL.");
  }
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

function buildPaymentFailureHtml(input: SendPaymentFailureEmailInput) {
  const resolvedPayDate = input.payDate?.trim() ? formatDate(input.payDate) : "Chưa ghi nhận";
  const responseCode = input.responseCode?.trim() || "--";
  const bankCode = input.bankCode?.trim() || "--";

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#f97316,#dc2626);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;">NovaX Market</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">Thanh toán chưa thành công</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">Xin chào <strong>${escapeHtml(input.toEmail)}</strong>,</p>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.7;">
            Hệ thống ghi nhận trạng thái giao dịch <strong>${escapeHtml(input.txnRef)}</strong> chưa hoàn tất trên VNPAY.
          </p>
          <div style="padding:20px;border-radius:20px;background:#fff1f2;border:1px solid #fda4af;">
            <p style="margin:0 0 8px;font-size:14px;color:#9f1239;">Lý do</p>
            <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#881337;">${escapeHtml(input.failureReason)}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#9f1239;">Mã giao dịch</p>
            <p style="margin:0;font-size:16px;font-weight:600;color:#881337;">${escapeHtml(input.txnRef)}</p>
          </div>
          <table style="width:100%;margin-top:24px;border-collapse:collapse;">
            <tbody>
              <tr>
                <td style="padding:10px 0;color:#64748b;">Số tiền</td>
                <td style="padding:10px 0;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(formatCurrency(input.totalAmount))}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #e2e8f0;">Nội dung giao dịch</td>
                <td style="padding:10px 0;text-align:right;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(input.orderInfo)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #e2e8f0;">Mã phản hồi</td>
                <td style="padding:10px 0;text-align:right;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(responseCode)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #e2e8f0;">Ngân hàng</td>
                <td style="padding:10px 0;text-align:right;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(bankCode)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #e2e8f0;">Thời điểm ghi nhận</td>
                <td style="padding:10px 0;text-align:right;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(resolvedPayDate)}</td>
              </tr>
            </tbody>
          </table>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#475569;">
            Bạn có thể thử lại thanh toán hoặc liên hệ với ngân hàng để biết thêm chi tiết. Nếu cần hỗ trợ, vui lòng liên hệ với bộ phận chăm sóc khách hàng của NovaX Market.
          </p>
        </div>
      </div>
    </div>
  `;
}

function buildOrderFailureHtml(input: SendOrderFailureEmailInput) {
  const rows = input.items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(item.productName?.trim() || item.productId)}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center;">${item.quantity}</td>
    </tr>
  `).join("");

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#fb923c,#dc2626);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;">NovaX Market</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">Đơn hàng chưa thể xử lý</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">Xin chào <strong>${escapeHtml(input.toEmail)}</strong>,</p>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.7;">Hệ thống chưa thể hoàn tất yêu cầu đặt hàng của bạn.</p>
          <div style="padding:20px;border-radius:20px;background:#fff1f2;border:1px solid #fda4af;">
            <p style="margin:0 0 8px;font-size:14px;color:#9f1239;">Lý do</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#881337;">${escapeHtml(input.failureReason)}</p>
          </div>
          ${input.requestId ? `<p style="margin:20px 0 0;font-size:14px;color:#475569;">Mã yêu cầu: <strong>${escapeHtml(input.requestId)}</strong></p>` : ""}
          <table style="width:100%;margin-top:24px;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:0 0 12px;text-align:left;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Sản phẩm</th>
                <th style="padding:0 0 12px;text-align:center;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Số lượng</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#475569;">Bạn có thể thử lại sau hoặc chọn sản phẩm khác. Nếu cần hỗ trợ thêm, vui lòng liên hệ NovaX Market.</p>
        </div>
      </div>
    </div>
  `;
}

export async function sendOrderConfirmationEmail(input: SendOrderConfirmationEmailInput) {
  assertSesConfigured();

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

export async function sendPaymentFailureEmail(input: SendPaymentFailureEmailInput) {
  assertSesConfigured();

  await sesClient.send(new SendEmailCommand({
    FromEmailAddress: env.SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [input.toEmail]
    },
    Content: {
      Simple: {
        Subject: {
          Data: `Thanh toán không thành công cho giao dịch ${input.txnRef}`,
          Charset: "UTF-8"
        },
        Body: {
          Html: {
            Data: buildPaymentFailureHtml(input),
            Charset: "UTF-8"
          }
        }
      }
    }
  }));
}

export async function sendOrderFailureEmail(input: SendOrderFailureEmailInput) {
  assertSesConfigured();

  await sesClient.send(new SendEmailCommand({
    FromEmailAddress: env.SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [input.toEmail]
    },
    Content: {
      Simple: {
        Subject: {
          Data: "Đơn hàng chưa thể xử lý tại NovaX Market",
          Charset: "UTF-8"
        },
        Body: {
          Html: {
            Data: buildOrderFailureHtml(input),
            Charset: "UTF-8"
          }
        }
      }
    }
  }));
}
