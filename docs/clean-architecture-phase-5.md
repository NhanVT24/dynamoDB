# Phase 5 — Checkout/payment recovery và manual review

Đã triển khai source code và kiểm thử local. Chưa deploy, chưa gọi VNPay thật,
chưa thao tác dữ liệu AWS. Phase này giữ mô hình use case/port/adapter của các
phase trước và bổ sung các đường xử lý khi flow bị gián đoạn.

## 1. Kết quả chính

| Khoảng hở trước đây | Cách xử lý hiện tại |
| --- | --- |
| Hold đã commit nhưng process chết trước khi tạo session | Request lặp hoặc recovery job tiếp tục từ order/items đã lưu, không giữ hàng lần nữa |
| Session đã lưu nhưng chưa attach link vào order | Session và paymentTxnRef/paymentUrl được ghi trong cùng DynamoDB transaction |
| Transaction commit nhưng response bị mất | Strong read order + session; trả lại durable winner nếu correlation khớp |
| Hai request cùng tạo link | Condition trên order chỉ cho một session/link thắng; session của request thua không được commit |
| Publish event thành công nhưng marker fail | Recovery tiếp tục dispatch, chấp nhận event lặp; order transaction vẫn idempotent |
| Job luôn đọc trang đầu | Checkpoint riêng cho từng lane, xử lý cả trang lọc rỗng, đi hết rồi wrap |
| IPN bị mất | Query provider có chữ ký, kiểm tra merchant/txnRef/amount/type/status rồi dùng chung đường confirm |
| Payment thành công sau khi hàng đã release | Ghi manual-review case trước khi ACK; không tự refund, không bán lại inventory |
| Review store không ghi được | Worker vẫn fail, message được retry thay vì ACK mất sự cố |

## 2. Flow và file chính

Các đường dẫn tính từ `apps/api/src/modules`.

```text
CreateCheckout
  -> CheckoutOrders.hold: tạo hoặc đọc lại hold cùng customer/cart
  -> CreatePayment -> VnpayPaymentLinkIssuer
    -> createPaymentSession: transaction(session + order link)
  -> trả payment URL đã lưu

reconcile-payment-events Lambda
  -> RecoverPayments
    -> PaymentRecoveryQueue: đọc page + checkpoint
    -> PaymentRecoverySessions: strong read + claim/backoff
    -> PaymentStatusGateway: querydr, không refund/pay
    -> PaymentProcessing: confirm/resumeDispatch
    -> CheckoutProvisioning: tiếp tục checkout tạo dở

payment.completed worker
  -> ConfirmOrderPayment
    -> xác nhận durable payment + correlation
    -> paid transaction, hoặc PaymentReviewWriter.open
      -> PaymentReviewRequired chỉ được throw sau khi case đã lưu
    -> NotificationsService ACK manual-review outcome
```

| File | Vai trò |
| --- | --- |
| `vnpay/application/recover-payments.ts` | Điều phối recovery; giới hạn công việc và thời gian, kiểm tra backoff, tiếp tục sau lỗi từng item |
| `vnpay/application/ports/payment-recovery-ports.ts` | Contract cho queue/checkpoint, session, query gateway và checkout provisioning |
| `vnpay/infrastructure/dynamo-payment-recovery.ts` | Query GSI, cursor CAS, strong read session, claim provider-query attempt |
| `vnpay/infrastructure/vnpay-status-gateway.ts` | Ký querydr, timeout 3 giây, verify response và correlation |
| `vnpay/infrastructure/checkout-provisioning.ts` | Đọc order/items/bank/locale đã lưu và gọi lại CreateCheckout |
| `vnpay/infrastructure/vnpay-payment-link-issuer.ts` | Local signing và replay session/link thắng transaction |
| `vnpay/vnpay.repository.ts` | Atomic session + link; giữ conditional pending -> terminal và hand-off marker |
| `storefront/application/ports/payment-review.ts` | Contract hồ sơ cần operator xử lý và typed error sau durable write |
| `storefront/application/confirm-order-payment/confirm-order-payment.ts` | Quyết định commit paid hoặc đưa sang manual review |
| `storefront/infrastructure/persistence/dynamo-payment-reviews.ts` | Idempotent review creation, paging, resolve và escalation |
| `vnpay/payment-recovery.controller.ts` | API admin để xem và ghi nhận đã xử lý case |
| `vnpay/payment-recovery.module.ts` | Composition root wire các adapter vào RecoverPayments |

Application/domain không import NestJS, AWS SDK hoặc infrastructure implementation.
Recovery module được root AppModule import; VnpayModule không import ngược
StorefrontModule, tránh Nest module cycle. CreateCheckout được export từ
StorefrontModule để recovery dùng cùng use case với HTTP/workflow.

## 3. Atomic provisioning và compensation

Việc tạo payment link là local signing, không phải một API charge tiền. Transaction
ghi session và link có các điều kiện:

- Session chưa tồn tại.
- Order vẫn awaiting_payment và chưa hết lockedUntil.
- Customer và amount khớp snapshot.
- Order chưa có paymentTxnRef.

Nếu request khác thắng, issuer chỉ trả lại winner đã strong read và kiểm tra.
Nếu không chứng minh được commit thành công, vẫn trả lỗi; không tự coi là thành công.

Không tự release hold khi gặp lỗi tạo link chưa rõ kết quả: request khác có thể
vừa commit một session hợp lệ. Client/recovery có thể retry; expiry xử lý hold
chưa thanh toán. Đây là thay đổi có chủ ý so với compensation của Phase 4.

Bank code và locale được lưu trên hold mới. Recovery dùng lại giá order/items
đã commit, không đọc giá product hiện tại để tính lại payment amount.

## 4. GSI, checkpoint và backlog

Schema `StatusTimelineIndex` trong repo có các key components status, updatedAt,
searchName và PK. Payment/order không có searchName nên không thể dựa vào index
này để tìm đủ record cần recovery.

Recovery, expiry, refund candidate và manual-review reads chuyển sang index đã có:

```text
EntityUpdatedAtIndex
partition: entityType
sort: updatedAt
projection: ALL
```

Không sửa schema CDK, không thêm GSI, không cần backfill searchName. Đây là kiểm
tra source schema, chưa xác nhận index/schema của table đang deploy.

Mỗi lane có item checkpoint:

```text
PK = RECOVERY_CURSOR#payment#pending | success | failed | checkout | refund
SK = DETAIL
cursor = LastEvaluatedKey (opaque JSON)
revision = optimistic concurrency version
```

Payment job xử lý bốn lane đầu, default tối đa 5 evaluated records/lane/lần gọi,
budget 40 giây. Page rỗng sau filter vẫn được checkpoint. Cuối index reset cursor
để vòng sau duyệt lại; record thất bại sẽ được gặp lại khi wrap. Nếu hết budget
giữa page thì không checkpoint page đó. Concurrent job không ghi đè checkpoint
mới hơn vì có condition revision.

Refund job có lane riêng. Để giữ nguyên repository port Phase 3, refund adapter
checkpoint sau khi đọc candidate, trước provider processing; crash sau đó được
thử lại khi wrap. Schedule chỉ yêu cầu 3 evaluated records/lần để giảm khả năng
vượt timeout 60 giây với query refund hiện có.

**Trade-off:** đây là bounded query trên lịch sử entity, không phải sparse outbox
queue. History lớn thì một vòng duyệt dài và recovery có thể chậm hơn deadline
giữ hàng. Cần đo tốc độ ghi/độ dài vòng duyệt; không cam kết recovery latency hoặc
eventual dispatch dưới tải vượt khả năng job. Sparse recovery index/work queue
chuyên dụng là bước phù hợp nếu workload tăng.

## 5. Query provider khi mất IPN

- Chỉ query session pending đã tồn tại tối thiểu 60 giây và hết backoff.
- Claim attempt + nextAt bằng conditional write trước network call. Job chồng
  nhau cùng snapshot chỉ có một claim thắng; không có lease takeover để resend money.
- Backoff 5, 10, 20, 40 phút, sau đó tối đa 60 phút giữa các lần thử.
- Query dùng transactionDate gốc; request HMAC SHA-512; response được verify
  checksum, command, merchant và txnRef.
- Chỉ response query thành công, transaction type `01`, transaction status `00`,
  amount và transaction number/payDate hợp lệ mới được đưa vào confirm success.
- Query thành công không đồng nghĩa payment thành công. Refund transaction,
  pending, not-found, timeout hoặc unknown không bị biến thành payment failed.
- Sau ít nhất 12 query không xác lập thành công (kể cả timeout/config/signature error), order-linked session có hồ sơ
  PROVIDER_UNCONFIRMED; payment vẫn pending và query tiếp tục theo backoff.

IPN và provider query dùng chung conditional pending -> terminal. Một IPN khác
outcome không được ghi đè kết quả đã lưu. Chưa có tự xử lý contradictory gateway
outcomes; chúng được log để operator điều tra.

Tài liệu đối chiếu: [VNPay querydr/refund](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html),
[VNPay response codes](https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/),
[AWS GSI sparse keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html).

## 6. Manual review và runbook

Case được lưu trong cùng table, namespace `PAYMENT_REVIEW#<txnRef>`/DETAIL,
entityType PAYMENT_REVIEW, status payment_review_open hoặc payment_review_resolved.
Không đặt TTL tự xóa case chưa xử lý.

Reasons hiện có:

- PAID_AFTER_RELEASE: payment đã success nhưng order expired/cancelled/payment_failed.
- CORRELATION_MISMATCH: durable successful payment không khớp held order.
- PROVIDER_UNCONFIRMED: query nhiều lần chưa xác lập được successful payment.

Put có condition nên duplicate message không tạo thêm case. Case cùng identity
đã resolved không bị mở lại bởi cùng sự kiện. Riêng một case PROVIDER_UNCONFIRMED
được nâng thành sự cố có successful payment thì sẽ reopen; bằng chứng xử lý cũ
được giữ trong previousResolution, tránh che mất tiền đến muộn.

Worker chỉ ACK đường manual-review sau khi case đã lưu. SNS admin alert là best
effort; API case là nơi đọc lại được nếu alert delivery thất bại. Case creation
không tự gửi refund, không đổi payment success thành failed, không trừ stock lại.

API chỉ cho admin, dùng cơ chế Cognito/principal hiện có:

```http
GET /api/admin/ops/payment-reviews?limit=20&cursor=<nextCursor>

POST /api/admin/ops/payment-reviews/<txnRef>/resolve
Content-Type: application/json

{
  "note": "Đã đối chiếu provider và xác nhận xử lý ngoài hệ thống",
  "externalReference": "provider-or-fulfillment-reference"
}
```

Operator cần đọc cả payment, order và provider evidence; quyết định fulfillment
hoặc refund theo quy trình vận hành rồi mới resolve. Resolve chỉ ghi actor, note,
reference và timestamp; nó không thực thi quyết định tiền/kho và không tự chứng
minh externalReference là thật. Resolve lặp trả CONFLICT. Frontend quản trị chưa
có màn hình mới; có thể sử dụng API qua công cụ vận hành hiện có.

GET dùng GSI eventual consistency. Theo nextCursor cả khi items rỗng; reload có
thể tạm thấy case vừa resolve. POST dùng conditional write trên record thật.

## 7. Kiểm chứng

Tại `apps/api`:

```powershell
npm run typecheck
npm run test:storefront
npm run test:shopping
npm run test:audit
```

Storefront gồm 34 regression tests và 18 recovery tests, tổng 52; shopping 26;
audit 29. Có thêm typecheck riêng các test files và dependency/diff checks.

Recovery tests bao gồm timeout/backoff, unknown provider result, filtered-empty
pagination, checkpoint revision race, query-attempt race, checkout resume,
concurrent issuer, expired-order race, lost commit response, refund backlog,
manual-review paging/resolve/escalation, actual HMAC verification, mất IPN và
publish-success/marker-failure, compiled HTTP auth và actual payment worker ACK.

Database/provider/alert transport được giả lập; Nest, Fastify, SDK/audit middleware,
crypto và worker orchestration là code thật chạy trong test. Fake không phải
DynamoDB expression engine. Docker daemon chưa chạy, Java chưa có nên chưa chạy
DynamoDB Local; chưa có AWS/VNPay runtime proof.

## 8. Giới hạn và rollout

- Không sửa Construct/Lambda/table/index IDs và chưa deploy; cần xác nhận
  EntityUpdatedAtIndex, IAM và provider query endpoint trên staging trước release.
- Chưa backfill/migrate execution Step Functions cũ hoặc tự sửa orphan session
  tạo bởi version cũ. Record thiếu transactionDate, partial legacy linkage hoặc
  contradictory outcome vẫn cần operator điều tra.
- Query/backoff có thể xác nhận payment sau khi hold đã release; khi đó tạo review,
  không cam kết fulfill tự động trong mọi trường hợp mất IPN.
- Batch/cursor cần tuning theo history và throughput; chưa có sparse outbox index
  hoặc recovery latency SLA. Email/notification/audit side effects vẫn có delivery
  semantics riêng, chưa có exactly-once guarantee cho toàn hệ thống.
- Chưa có UI manual review, auto refund hay tự re-reserve inventory. Không reset
  checkpoint trong khi job đang chạy nếu chưa hiểu khả năng đọc lại record.
- Provider chưa query được vì cấu hình/chữ ký/HTTP failure sẽ log và backoff,
  tạo manual case khi đạt threshold 12 claimed attempts. Chưa có automatic circuit
  breaker; theo dõi payment.recovery_item_failed và alarm vận hành.

Logs cần theo dõi: payment.recovery_item_failed, payment.manual_review_required,
payment.provider_unconfirmed_review, payment.review_store_failed,
checkout.provisioning_interrupted. Case open
không được bỏ qua chỉ vì Lambda invocation trả thành công hoặc SQS đã ACK.
