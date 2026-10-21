# Phase 4 — Checkout, payment, worker và expiry

Các giới hạn trong báo cáo này mô tả thời điểm kết thúc Phase 4. Những thay đổi
recovery tiếp theo được ghi tại [Phase 5](clean-architecture-phase-5.md).

Phase 4 tách orchestration của checkout/payment khỏi NestJS và DynamoDB, đồng thời
đồng bộ các inventory writers đang hoạt động. Đây là thay đổi source code local,
chưa deploy AWS hoặc kiểm chứng gateway VNPay thật.

## 1. Các use case đã tách

Các đường dẫn bên dưới tính từ `apps/api/src/modules`.

| Use case | File | Trách nhiệm |
| --- | --- | --- |
| CreateCheckout | storefront/application/create-checkout/create-checkout.ts | Validate cart, giữ hàng, tạo session theo giá đã commit, attach link, compensation khi tạo payment thất bại |
| GetCheckoutStatus | storefront/application/get-checkout-status/get-checkout-status.ts | Kiểm tra ownership; yêu cầu expiry theo deadline |
| CreatePayment | vnpay/application/create-payment.ts | Validate số lượng, amount, expiry; dùng giá checkout nếu đã có snapshot |
| PaymentProcessing | vnpay/application/payment-processing.ts | Commit kết quả payment, kiểm tra replay, hand-off event và reconcile marker chưa hoàn tất |
| ConfirmOrderPayment | storefront/application/confirm-order-payment/confirm-order-payment.ts | Kiểm tra payment success đã lưu, customer/amount/order/txnRef; commit paid và soldCount |
| ExpireOrders | storefront/application/expire-orders/expire-orders.ts | Duyệt candidate, yêu cầu conditional expiry, tiếp tục và báo số lỗi theo từng order |
| WorkflowCheckout | storefront/application/workflow-checkout/workflow-checkout.ts | Cho Step Functions dùng cùng checkout flow với HTTP |
| ReadWorkflowPayment | cùng file trên | Đọc lại session/link đã attach, tránh tạo session mới khi retry workflow |
| FinalizeOrder | storefront/application/finalize-order/finalize-order.ts | Giữ flow direct order queue cũ; dùng requestId cố định để commit inventory một lần |

`FinalizeOrder` là đường direct order compatibility, có semantics commit inventory
ngay như trước. Payment workflow đã chuyển sang `WorkflowCheckout`, không còn gọi
đường này trước khi khách thanh toán. Không xem hai flow là cùng một semantics.

## 2. Các vùng giao tiếp thế nào

```text
HTTP StorefrontController
  -> StorefrontService (facade)
    -> CreateCheckout
      -> CheckoutOrders port
        -> DynamoCheckoutOrders
          -> storefront.store.ts -> DynamoDB transaction
      -> CheckoutPayments port
        -> adapter được wire trong StorefrontModule
          -> VnpayService -> CreatePayment -> VnpayPaymentLinkIssuer

VNPay IPN
  -> VnpayService: signature + merchant + định dạng callback
    -> PaymentProcessing
      -> PaymentSessions -> DynamoPaymentSessions
      -> FailedPaymentOrders -> DynamoFailedPaymentOrders
      -> PaymentEvents -> NotificationPaymentEvents -> EventBridge

payment.completed event
  -> NotificationsService (queue adapter + notification orchestration)
    -> ConfirmOrderPayment
      -> SettledPayments -> DurableSettledPayments (strong read)
      -> CheckoutOrders -> DynamoCheckoutOrders (atomic commit)
    -> notification / email / audit sau commit

Schedule
  -> ExpireOrders hoặc PaymentProcessing.reconcile
    -> port -> adapter
```

Ports nằm ở `storefront/application/ports/checkout-ports.ts`,
`order-finalization-ports.ts` và `vnpay/application/ports/payment-ports.ts`.
Payment creation ports hiện nằm cùng `create-payment.ts`; workflow reader port
nằm cùng `workflow-checkout.ts`, vì các contract này chỉ phục vụ một nhóm nhỏ.

Application gọi method trên object đã được constructor injection cung cấp.
`import type` chỉ giúp kiểm tra contract lúc compile; nó không tự tìm implementation.
Các `Module` của Nest là composition root: `useFactory` tạo adapter rồi truyền
object thật vào use case. Domain/application mới không import Nest, AWS SDK,
runtime config hay implementation trong infrastructure.

## 3. Inventory transaction chung

File `shopping/infrastructure/persistence/inventory-transaction.ts` tạo ba
operations cho mỗi product:

1. Update product với condition version của snapshot vừa đọc.
2. Delete category index item theo category/timestamp cũ.
3. Put category index item mới chứa đúng stock, soldCount, status và version.

Ba operations được ghép vào **cùng transaction với order/refund**. Không còn
cách ghi stock trước rồi update status riêng ở đường direct order queue.
Builder cũng tăng timestamp tối thiểu 1 ms nếu timestamp mới trùng timestamp cũ,
để Delete và Put không trỏ vào cùng index item trong một transaction.

| Thay đổi | Stock | soldCount |
| --- | --- | --- |
| Tạo checkout hold | - quantity | giữ nguyên |
| Payment thành công | giữ nguyên | + quantity |
| Cancel / expire / payment_failed | + quantity | giữ nguyên |
| Refund thành công | + quantity | - quantity |
| Direct order queue compatibility | - quantity | + quantity |

Status dùng lại `deriveStockStatus`: <= 0 là out_of_stock, <= 10 là low_stock,
còn lại active. Stock thay đổi reset inventory alert metadata; paid chỉ thay đổi
soldCount thì giữ alert metadata hiện tại.

Product được strong read và version được kiểm tra khi commit. Có concurrent
catalog edit/inventory update thì transaction fail, không ghi đè snapshot cũ.
Counter âm, fraction/overflow hoặc product thiếu ID bị từ chối.

Cart tối đa 20 dòng, quantity sau merge tối đa 50/product. Hold dùng tối đa
`1 + 4 * 20 = 81` operations; paid/release/refund thường `1 + 3 * 20 = 61`,
thêm một payment ConditionCheck khi release order có session.
Index này là materialized item trong table; không phải một GSI mới.

## 4. Idempotency và các race đã xử lý

- **Checkout gửi lại cùng requestId:** trả lại link đã attach nếu cùng owner/cart,
  order vẫn awaiting và chưa hết hạn. Không giữ hàng/tạo session lần nữa.
- **Checkout đang tạo dở:** trả CONFLICT. Không cho request thứ hai tạo session
  hoặc compensation hộ request đầu tiên. Chưa có tự takeover session creation.
- **Payment IPN:** pending -> terminal dùng conditional update. Thua race phải
  strong read kết quả đã lưu rồi so sánh outcome trước khi ACK.
- **Duplicate callback:** nếu chưa có marker thì tiếp tục hand-off. Nếu đã có
  marker thì không publish lại. Callback khác outcome bị từ chối để reconcile.
- **Publish thành công nhưng marker fail:** callback/reconcile sẽ publish lại.
  Đây là at-least-once; không có cam kết exactly-once cho toàn bộ side effects.
- **Worker lặp:** order condition ngăn soldCount tăng lần hai. Worker kiểm tra
  payment success đã lưu và correlation, không chỉ tin email/amount trong event.
- **Refund window:** thời điểm payment lấy từ signed IPN đã lưu (fallback paidAt),
  không lấy payDate có thể sửa trong queue payload hoặc thời gian worker chạy lại.
- **Expiry/cancel vs successful IPN:** strong read trước và ConditionCheck trên
  payment trong cùng transaction ngăn trả hàng khi session đã success.
- **IPN đến sau khi expiry đã commit:** payment vẫn được lưu success. Worker báo
  reconciliation required, giữ retry/DLQ; không tự coi tiền chưa được thanh toán.
- **Stale GSI candidate:** expiry recheck status/deadline ở transaction; payment
  reconcile strong read session trước khi dispatch.
- **Direct order queue retry sau lỗi notification:** order ID = requestId. Đọc lại
  cùng order hoặc cạnh tranh trên conditional Put, không tạo ID ngẫu nhiên mới.

HTTP return của VNPay vẫn chỉ verify và đọc trạng thái. Browser không finalize
payment, không release stock, không publish event. IPN giữ các response code
00/02/04/01/97/99. Payment creation giữ response fields hiện có.

## 5. Workflow thay đổi có chủ ý

Trước đây OrderWorkflowTask tạo direct order, trừ stock và tăng soldCount; sau đó
PaymentWorkflowTask đọc giá product để tạo link. Nó có thể lấy giá khác snapshot
có sale, đồng thời payment worker lại tìm held-order format khác.

Hiện tại:

```text
OrderWorkflowTask -> WorkflowCheckout -> hold + payment session/link đã attach
PaymentWorkflowTask -> ReadWorkflowPayment -> trả lại cùng session/link
VNPay IPN -> payment.completed -> ConfirmOrderPayment -> paid + soldCount
```

Order task trả outcome success với status awaiting_payment; payment task vẫn trả
paymentUrl/txnRef/amount/orderInfo/expiresAt/timeoutMinutes. ID của Lambda,
Step Functions state machine, Construct và table/GSI không thay đổi trong CDK.

Trước rollout thật cần xử lý/drain execution cũ đang nằm giữa hai step, vì
orderResult của execution cũ trỏ vào direct-order format. Không có tự động migrate
execution hoặc tự sửa dữ liệu inventory đã được flow cũ commit.

## 6. Cleanup

- `storefront.repository.ts` giữ compatibility re-export cho các caller cũ;
  persistence implementation chuyển vào `infrastructure/persistence/storefront.store.ts`.
- Xóa code gate/reservation/race-barrier đã kiểm tra không có caller: tạo/release/
  commit checkout reservation, cleanup gate và barrier test cũ. Các schema/script
  migration và audit support cho dữ liệu lịch sử vẫn được giữ khi còn mục đích.
- Xóa helper finalize/payment dispatch cũ khỏi service sau khi chuyển sang use case.
- Hai schedule handlers dùng cached Nest context, không close context sau mỗi
  invocation; có audit actor/requestId riêng cho từng invocation.
- Signed paymentUrl được lưu để replay checkout nhưng bị loại khỏi audit changes.

## 7. Kiểm chứng và giới hạn

Chạy từ `apps/api`:

```powershell
npm run typecheck
npm run test:storefront
npm run test:shopping
npm run test:audit
```

- 34 storefront tests: 15 regression Phase 3 + 19 payment/checkout/workflow tests.
- 26 shopping regression tests.
- 29 audit tests, gồm test không đưa signed paymentUrl vào audit log.
- Typecheck riêng các test files, kiểm tra dependency hướng vào trong và diff whitespace.

Test dùng pure use cases, SDK transport fake, actual audit middleware, crypto thật,
compiled Nest/Fastify HTTP, actual notification worker method và Lambda handlers.
Fake kiểm tra construction, version/state race và atomic rollback mô phỏng;
**không phải DynamoDB expression engine**. Docker daemon hiện chưa chạy, nên chưa
chạy DynamoDB Local. Chưa chứng minh IAM, GSI consistency, retry/DLQ routing,
gateway VNPay hoặc email delivery trên AWS thật.

Các giới hạn cần giữ rõ khi lên phase sau:

- Crash sau hold/trước attach link vẫn có thể để checkout đang tạo dở; request
  lặp nhận CONFLICT. Expiry giải phóng hold chưa thanh toán; chưa có provisioning
  recovery state machine để tự tiếp tục tạo/attach payment.
- Email/notification/audit phía sau commit vẫn có delivery semantics riêng.
  Chưa có outbox thống nhất hoặc deduplication cho mọi side effect; một số
  notification/lifecycle event có thể lặp khi retry.
- Payment recovery query giữ bounded batch trên StatusTimelineIndex và filter
  marker; chưa có sparse outbox index/durable cursor/fair scheduling cho backlog
  lớn. Không tuyên bố job này đảm bảo eventual dispatch cho mọi backlog.
- Chưa tự query provider để xác nhận session còn pending khi IPN bị mất hoàn toàn.
  Job payment hiện reconcile hand-off của kết quả đã được ghi, không thay thế IPN.
- Paid-after-release cần operator reconciliation/refund policy; không tự refund mù.
- Code reservation cũ bị bỏ, nhưng dữ liệu reservation lịch sử chưa được scan/xóa
  hay tự hoàn trả trong lần refactor này.
- NotificationsService vẫn có notification orchestration và storefront queries
  vẫn còn facade/persistence compatibility. Không tuyên bố toàn backend đã clean.
- Thêm index operations và strong reads làm tăng read/write cost và khả năng
  optimistic conflict; cần đo workload thật trước khi tối ưu batching/retry.

Ưu tiên tiếp theo là integration tests bằng DynamoDB Local/staging, rollout tương
thích execution cũ, rồi recovery/outbox/observability cho các khoảng hở trên.
