# Clean Architecture — Phase 3: Cancel và refund

## Phạm vi thực hiện

Chuyển cancel/refund/customer polling/scheduled reconciliation thành bốn use case
độc lập NestJS và AWS SDK. Giữ HTTP routes và response shapes, ownership theo
customerEmail, refund window 5 phút và cơ chế conditional transaction hiện có.
Không thay CDK, table/index schema, queue payload hoặc toàn bộ checkout/payment flow.

## Đường gọi

```text
StorefrontController -> StorefrontService facade
  -> CancelOrder / RequestRefund / RefreshRefundStatus
      -> domain policy + application ports
          <- DynamoDB / VNPay / SES / Nest logger adapters

Scheduled Lambda -> ReconcilePendingRefunds
                    -> RefundResolution dùng chung với HTTP polling
```

StorefrontModule là composition root. Use cases không import concrete adapters,
Nest exceptions, PaymentSessionRecord, PK/SK hoặc provider credentials.

## File và trách nhiệm

Các đường dẫn viết gọn bên dưới thuộc `apps/api/src/modules/storefront/`.

| File | Trách nhiệm |
| --- | --- |
| `domain/order-refund.ts` | Order/refund states, business projections và eligibility window |
| `application/cancel-order/cancel-order.ts` | Ownership + cancel orchestration |
| `application/request-refund/request-refund.ts` | Eligibility, payment checks, claim identity và một lần request provider |
| `application/refresh-refund-status/refresh-refund-status.ts` | Customer polling, giữ pending/current khi query chưa xác định |
| `application/reconcile-pending-refunds/reconcile-pending-refunds.ts` | Bounded batch recovery, re-read sau GSI và per-order error isolation |
| `application/refund-resolution.ts` | Query/apply outcome và notification dùng chung |
| `application/ports/order-lifecycle-ports.ts` | Cancel/refund repository, gateway, notification và logger contracts |
| `application/order-action.error.ts` | NOT_FOUND / CONFLICT / INVALID_INPUT độc lập HTTP |
| `application/order-access.ts` | Giữ not-found cho order không thuộc customer |
| `infrastructure/persistence/order-record.store.ts` | Consistent order/order-item reads, được legacy repository re-export |
| `infrastructure/persistence/dynamo-refund-orders.ts` | Claim, GSI query, conditional result write và stock restoration transaction |
| `infrastructure/persistence/dynamo-order-cancellation.ts` | Adapter cho transition dùng chung với payment/expiry |
| `infrastructure/payments/vnpay-refund-gateway.ts` | Payment projection, config checks và provider-specific outcome mapping |
| `infrastructure/payments/vnpay-refund-client.ts` | VNPay request signing, fetch timeout, response signature/correlation checks; chuyển từ vnpay module |
| `infrastructure/notifications/refund-email-notifier.ts` | SES integration, giữ skip khi chưa cấu hình sender |
| `infrastructure/order-operation-logger.ts` | Structured stage logs qua Nest logger |

## Cancel và race conditions

- Giữ existing behavior: order không còn awaiting_payment trả changed=false;
  không tự đổi paid/refund states sang cancelled.
- Adapter tiếp tục gọi transitionAwaitingPaymentOrder hiện có vì payment,
  notifications và expiry vẫn cần dùng function này đến Phase 4.
- Bổ sung customerEmail condition ngay trên order transaction khi caller cung cấp
  expectedCustomerEmail. Pre-read ownership không thay thế write-time condition.
- Hai cancellation/payment/expiry transitions cạnh tranh được quyết định tại
  order condition. Nếu có winner, re-read và trả released=false; không hoàn stock lần nữa.
- Chỉ order conditional failure được diễn giải là competing transition. Inventory
  condition failure, throttling, contention và network error không bị đổi thành success.

## Request refund

1. Đọc và kiểm tra order ownership, giữ 404 cho customer khác.
2. Nếu có refundRequestId, trả trạng thái đã ghi nhận; không gửi refund mới.
3. Domain kiểm tra paid + payment reference + confirmed timestamp + window 5 phút.
4. Xác minh payment success, amount và order identity khi payment có orderId.
5. Kiểm tra gateway config trước khi claim.
6. Conditional claim pending + requestId: kiểm tra paid status, exact paidAt,
   cutoff window, chưa có refundRequestId và customerEmail ngay tại database write.
7. Gửi provider đúng một application attempt, dùng requestId đã ghi nhận.
8. Ghi outcome có điều kiện rồi mới notify.

Gateway giữ VNPay secrets/config/signing phía ngoài application. Nó re-read payment
session trước request/query và xác minh lại amount/status. Native provider client
vẫn dùng timeout và signature validation hiện có; không thêm network retry cho refund.

## Tách rõ các giai đoạn thất bại

| Failure | Hành vi |
| --- | --- |
| Provider timeout/response không xác minh được | Giữ pending/unknown + request ID, query/reconcile sau; không resend |
| Provider đã trả kết quả nhưng persistence thất bại | Log refund.persistence_failed, đọc trạng thái authoritative; không báo definitive rejection hoặc gửi refund mới |
| Notification thất bại sau commit | Log refund.notification_failed; không đổi trạng thái tài chính đã commit |
| Claim mất race | Conflict; chưa gọi provider |
| Customer polling/query lỗi tạm thời | Giữ pending/current theo contract hiện tại |
| Scheduled item lỗi | Ghi failed và tiếp tục các item khác |

Logs phân biệt provider_result_unknown, persistence_failed, query_failed,
notification_failed và reconcile_failed với orderId/refundRequestId.

## Terminal outcome và inventory

RefundResolution được dùng cho cả request completion, customer polling và job.
Repository chỉ nhận pending + đúng refundRequestId. Khi refund_sent, order terminal
transition và stock/soldCount restoration vẫn ở cùng một DynamoDB transaction.

Nếu một caller khác đã hoàn tất cùng refund request, adapter trả changed=false
với trạng thái winner. Caller thua không restore inventory hoặc notify terminal lần nữa.
Inventory guard failure làm toàn bộ transaction thất bại và giữ order pending;
không được coi nó là race đã thành công.

Đây là bảo đảm của transaction/conditional contract; in-process tests kiểm tra mô
hình và command payload, chưa phải bằng chứng transaction execution trên AWS.

## Reconciliation job

- Giữ entrypoint và schedule hiện có, không thay CDK resource.
- Entry point gọi ReconcilePendingRefunds trực tiếp, bỏ facade reconcile cũ.
- Đọc batch qua StatusTimelineIndex, strong re-read từng candidate để tránh GSI lag.
- Chỉ xử lý order hiện vẫn pending, có request/payment reference.
- Bounded batch tối đa 100; mặc định 50; resolved chỉ đếm transition do invocation này thắng.
- Service audit context có lambda actor và awsRequestId, không rò sang invocation khác.
- Sửa warm-invocation bug: không close Nest context vì createStandaloneContext cache
  nó để tái sử dụng. Hai lần gọi handler trong cùng process được kiểm tra.

## Cleanup có kiểm tra caller

Đã xóa:

- `modules/vnpay/vnpay-refund.ts`: implementation đã chuyển vào storefront payment adapter.
- `modules/storefront/storefront.reporting.samples.ts`: sample helper không có caller
  trong source/tests/scripts/docs/infra đã rà soát.
- `modules/shopping/application/update-product/product-update.error.ts`: chuyển các
  caller/test cuối sang ProductMutationError, bỏ alias compatibility không còn dùng.

Đã dọn trong file còn hoạt động:

- Bỏ refund/cancel orchestration và notifyRefundStatus cũ khỏi StorefrontService.
- Bỏ facade reconcile không còn caller sau khi job chuyển sang use case.
- Bỏ private helpers không được gọi: ensureCheckoutGateCanProceedToPayment,
  precheckProducts, shouldProcessCommerceQueuesInline; type/imports không dùng liên quan.
- Chuyển refund-only persistence khỏi storefront.repository.ts; bỏ các export không còn caller.
- Giữ getAwaitingPaymentOrder/listOrderItems compatibility re-exports vì còn caller.
- Giữ storefront.service.ts/repository.ts và transitionAwaitingPaymentOrder vì còn
  checkout, payment, workers, reporting và expiry dependencies.
- Cập nhật backend-guide và tài liệu Phase 1/2 ở các đường dẫn đã đổi.

Compiler noUnusedLocals được dùng để rà phần storefront; không bật toàn cục trong
tsconfig hoặc xóa các module khác chỉ vì chưa đi qua Clean Architecture.

## Kiểm chứng

Tại `apps/api`:

```powershell
npm run typecheck
npm run test:storefront
npm run test:shopping
npm run test:audit
```

- 15 storefront tests: window boundary, auth/ownership/payment mismatch, duplicate
  request/concurrent claim, ambiguous timeout, persistence vs notification errors,
  polling/job race, stale GSI candidate, transaction/inventory failure, signed provider
  requests/responses và mismatch amount, HTTP DI/error/response contracts, warm job context.
- 26 shopping regression tests sau khi bỏ error alias.
- 28 audit regression tests.
- Build bằng tsc; typecheck riêng ba shopping/storefront test files.
- Kiểm tra dependency của domain/application và git diff --check.

Database/provider/SES được giả lập. Nest/Fastify DI, actual audit middleware,
crypto signing và response verification là code thực chạy trong test. Docker daemon
chưa hoạt động, nên chưa dùng DynamoDB Local; chưa deploy hoặc kiểm chứng VNPay,
Cognito, SES hay Streams trên môi trường thật.

## Giới hạn còn lại và Phase 4

- Claim commit rồi process chết trước khi gửi provider vẫn có thể để pending.
  Query/reconcile không chứng minh provider đã nhận refund; không tự takeover hoặc
  resend mù. Chưa thêm manual-review workflow/outbox cho tình huống đó.
- Terminal email là best effort, không có delivery guarantee/retry ledger mới.
- Query batch giữ cơ chế hiện có, chưa thêm durable cursor/fair scheduling cho backlog
  lớn hoặc pending kéo dài, chưa thay đổi timeout tổng thể của Lambda.
- Giữ inventory transaction của các order writers hiện có; các write này chưa đồng
  bộ đầy đủ product status/category snapshots như shopping mutations. Cần giải quyết
  nhất quán ở Phase 4 khi rà toàn bộ checkout/payment/expiry/inventory writers.
- Shared payment/expiry transition vẫn nằm trong legacy repository, được cancel
  adapter bao quanh; không tuyên bố toàn bộ storefront đã chuyển sang Clean Architecture.
