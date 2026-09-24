import assert from "node:assert/strict";
import { test } from "node:test";
import { orderConfirmationContent } from "../src/integrations/ses/order-confirmation-template.js";

test("paid receipt shows the checkout price snapshot and keeps order ID out of the subject", () => {
  const receipt = orderConfirmationContent({
    toEmail: "customer@example.com",
    orderId: "order-123",
    totalAmount: 180_000,
    createdAt: "2026-09-24T08:00:00.000Z",
    paymentConfirmedAt: "2026-09-24T08:05:00.000Z",
    orderUrl: "https://truyenmasinhvien.com/store/orders/detail?orderId=order-123",
    items: [{
      productName: "Áo <Sale>", quantity: 2,
      unitPrice: 90_000, originalUnitPrice: 120_000, lineTotal: 180_000
    }]
  });

  assert.equal(receipt.subject, "Thanh toán thành công | NovaX Market");
  assert.ok(!receipt.subject.includes("order-123"));
  assert.match(receipt.html, /Áo &lt;Sale&gt;/);
  assert.match(receipt.html, /text-decoration:line-through/);
  assert.match(receipt.html, /Đã giảm: -60\.000/);
  assert.match(receipt.html, /Xác nhận thanh toán/);
  assert.match(receipt.html, /Mã đơn hàng để tra cứu\/hỗ trợ: order-123/);
  assert.match(receipt.text, /120\.000.*90\.000.*180\.000/);
  assert.match(receipt.html, /href="https:\/\/truyenmasinhvien\.com\/store\/orders\/detail\?orderId=order-123"/);
});

test("new order does not claim it was paid or invent a historical discount", () => {
  const receipt = orderConfirmationContent({
    toEmail: "customer@example.com",
    orderId: "order-456",
    totalAmount: 50_000,
    createdAt: "2026-09-24T08:00:00.000Z",
    items: [{ productName: "Sách", quantity: 1, unitPrice: 50_000, lineTotal: 50_000 }]
  });

  assert.equal(receipt.subject, "Đơn hàng đã được ghi nhận | NovaX Market");
  assert.match(receipt.html, /Đặt hàng/);
  assert.doesNotMatch(receipt.html, /Tổng đã thanh toán|Đã giảm|text-decoration:line-through/);
});
