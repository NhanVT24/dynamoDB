# Audit phạm vi Clean Architecture của toàn backend

## Kết luận

**Chưa chuyển toàn bộ backend sang Clean Architecture.** Source hiện tại là kiến
trúc kết hợp: commerce use cases đã có core độc lập framework và output ports;
nhiều capability khác vẫn điều phối nghiệp vụ trong controller/service/function
gọi trực tiếp repository hoặc AWS integration.

Phase 7 là phase cuối của đợt migrate các flow đã chọn và hardening, không phải
bằng chứng toàn bộ backend đã migrate. Audit này kiểm tra source trong workspace
hiện tại, gồm thay đổi Phase 7 chưa commit; không phải audit AWS runtime.

## Tiêu chí đánh giá

1. Business rule và orchestration có tách khỏi HTTP/SQS/Cognito event format không?
2. Khi cần database/provider, application gọi business contract hay concrete SDK?
3. Domain/application có import framework, config, persistence types hay adapter?
4. Concrete implementations có được nối ở composition root hay bị new/import
   trực tiếp từ core?
5. Có API/job/trigger nào đi đường khác và vẫn tự thực hiện cùng nghiệp vụ không?

Không đánh giá bằng số folder. Controller, AWS SDK adapter, module wiring và health
endpoint vẫn có thể tồn tại bình thường. Database conditions, transactions và
provider-specific serialization phải ở adapter; không di chuyển chúng vào domain.

## Inventory theo capability

Đã inventory 14 thư mục feature trực tiếp dưới modules, gồm 153 TS files. Có 46
files trong application/domain, thuộc shopping/storefront/vnpay/notifications/sales.
Số file không phải tỷ lệ hoàn thành: các adapter hợp lệ không cần trở thành core.

| Capability | Trạng thái | Bằng chứng/phần còn lại |
| --- | --- | --- |
| Shopping mutations | Có use case/port/adapter | CreateProduct, UpdateProduct, IncrementProductField, DeleteProduct được nối trong ShoppingModule |
| Shopping management/owned reads | Chưa đồng bộ với write flows | ShoppingService gọi shopping.repository trực tiếp; listOwnedShoppingItems lấy tối đa 20 pages rồi lọc owner |
| Storefront checkout/order lifecycle | Có use case/port/adapter cho các flow đã migrate | CreateCheckout, ConfirmOrderPayment, FinalizeOrder, CancelOrder, ExpireOrders, refund/reconcile và workflow |
| Storefront public product/order reads | Có use case/port/adapter | GetProduct/ListProducts, GetOrderDetails/ListMyOrders; read projections và ownership policy |
| Storefront revenue reporting | Chưa tách | storefront.reporting.ts trộn Scan/Query, raw order record, date filtering và aggregation |
| VNPay payment processing/recovery | Có core cho các flow chính; module vẫn kết hợp | CreatePayment, PaymentProcessing, RecoverPayments có contracts; callback parsing/provider response mapping là outer adapter hợp lệ; các nhánh legacy/test/notification vẫn trong VnpayService |
| Manual review admin | Chuyển một phần | Writer mở review dùng PaymentReviewWriter; PaymentRecoveryController list/resolve vẫn inject DynamoPaymentReviews trực tiếp |
| Notifications | Chuyển một phần | CompleteNotifiedOrder/ConfirmOrderPayment đã tách; customer visibility/ownership, CRUD, payment failed, inventory alert và delivery orchestration vẫn trong NotificationsService |
| Sales | Chỉ pricing policy đã tách | sales/domain/sale-pricing.ts độc lập; SalesService vẫn chứa campaign validation/state/retry/compensation cùng repository và AWS Scheduler |
| Customer directory | Chưa có application boundary độc lập | CustomersController gọi listVerifiedCustomers; filtering enabled/verified, dedup và Cognito ListUsers cùng trong cognito-customer-directory.ts |
| Profile/authorization | Chưa tách các flow chính | ProfileController trực tiếp Get/Update DynamoDB và HeadObject S3; AuthorizationService trực tiếp Cognito + authorization repository |
| Email deliveries/routes | Chưa tách orchestration thành application ports | EmailDeliveriesController chọn recipient được retry, tạo batch/idempotency IDs, lưu route và publish EventBridge; retry policy phụ thuộc env |
| Inventory reports | Chưa tách | sendDailyInventoryReport quyết định lịch/ngày, claim report, gọi SES, lưu trạng thái email/report và đánh dấu product |
| Data cleanup | Chưa tách | runScheduledDataCleanup quyết định retention/eligibility/backlog rồi gọi concrete repository |
| Audit log | Có pure logic và technical middleware; query service chưa đồng bộ | audit-log.ts có diff/types/policy dùng lại được; AuditLogService query/enrich trực tiếp repository và Cognito |
| Admin ops | Chưa tách operation orchestration khỏi concrete integrations | AdminOpsService dùng SQS/EventBridge trực tiếp để inspect/replay/delete/reset visibility |
| Uploads | Service tích hợp S3; chưa tách policy khỏi storage boundary | UploadsService quyết định public/private scopes, report access prefix và gọi S3/presigner; SDK không phải thứ cần bỏ, cần tách policy nếu muốn core độc lập |
| Health/learning | Không cần tạo các lớp nghiệp vụ rỗng | Health trả trạng thái; learning là endpoint bài tập/static placeholder |

## Các ví dụ xác nhận không chỉ là thiếu tên folder

### Profile update

`apps/api/src/modules/customers/authorization/profile.controller.ts`:

```text
PATCH /api/profile/me
  -> lấy principal + validate Zod
  -> quyết định avatar key được phép theo subject/default prefix
  -> S3 HeadObject
  -> tự dựng DynamoDB UpdateExpression
  -> DynamoDB UpdateItem
  -> đọc profile trả response
```

HTTP controller đang nhận cả policy lẫn persistence orchestration. Một boundary
phù hợp là UpdateProfile với ProfileRepository và AvatarStorage; controller giữ
HTTP/schema/principal mapping, adapter giữ HeadObject/UpdateExpression/conditions.

### Email retry và campaign publish

`apps/api/src/modules/email-deliveries/email-deliveries.controller.ts`:

- `safeRetryStatuses` quy định recipient nào được retry.
- `publishTrackedSaleEvent` tạo durable route, publish rồi đánh dấu hoặc lên lịch
  recovery khi kết quả publish ambiguous.
- Controller còn điều phối batch/identity và gọi concrete repositories/integration.

Đây là orchestration cần giữ idempotency/retry semantics khi chuyển vào use case;
không chỉ cắt method sang folder mới hoặc thêm interface quanh từng SDK function.

### Sale campaign

`apps/api/src/modules/sales/sales.service.ts`:

- `create` kiểm tra start/end và product existence, tạo campaign và hai schedules,
  compensate khi một phần Scheduler thất bại.
- `removeProduct` quyết định state nào được sửa, retry version conflicts, đóng
  campaign khi hết product và xóa schedule.

Domain pricing đã tách không đồng nghĩa lifecycle campaign đã tách. Use cases
CreateSaleCampaign/RemoveCampaignProduct/CancelSaleCampaign cần repository và
scheduler ports, giữ state/version/compensation hiện có.

### Flow đã migrate nhưng vẫn còn nhánh chưa migrate

`PaymentRecoveryController` đã chuẩn hóa HTTP auth trong Phase 7, nhưng vẫn inject
`DynamoPaymentReviews`. `PaymentReviewWriter` hiện phục vụ đường mở case; chưa có
application ListPaymentReviews/ResolvePaymentReview cho admin path. Controller ->
concrete adapter không chứng minh sai chức năng, nhưng đây chưa phải boundary
controller -> application -> port như các flow đã chọn.

`NotificationsService` gọi ConfirmOrderPayment nhưng vẫn tự đọc order repositories,
quyết định delivery/system notification/audit/admin alert và xử lý failed-payment
email. Không thể đánh dấu toàn module hoàn tất chỉ vì có một application folder.

## Ngoài Nest modules còn gì?

- Cognito triggers còn chứa account-status policy và profile initialization cùng
  DynamoDB/Cognito/EventBridge SDK. Ví dụ pre-authentication và post-confirmation.
- Email queue worker còn thực hiện delivery orchestration trong entrypoint; cần
  phân biệt decode/batch failure transport với quyết định delivery/retry.
- Weekly report handler gọi thẳng buildWeeklyRevenueSummary rồi SES mailer.
  Report aggregation và notification orchestration chưa có application boundary.
- HTTP server/Lambda bootstrap, SDK clients, signature serialization, middleware
  và CDK là outer infrastructure hợp lệ. Chúng không cần giả lập thành domain.

## Vì sao architecture check vẫn pass?

Đã chạy lại `npm run check:architecture`: **46 core files, 0 violations**.

`apps/api/scripts/check-architecture.js` chỉ chọn file theo pattern:

```text
modules/<feature>/application/**
modules/<feature>/domain/**
```

Vì vậy kết quả xác nhận chiều import của core hiện có, không xác nhận:

- Tất cả business capabilities đã được đưa vào core.
- Controller/service ở ngoài core không còn business rule.
- Mọi entrypoint đều gọi use case.
- Tất cả ports có semantic đúng và không giấu policy sai chỗ.

Một feature không có application/domain không bị checker bắt vì chưa thuộc
scope enforcement. Pattern hiện tại cũng không tự bao phủ future nested core
như customers/authorization/application. CI cần coverage inventory/approved
exceptions nếu muốn dùng làm gate cho tuyên bố migrate toàn backend.

Tests và dependency checks là hai loại bằng chứng riêng: test pass không tự chứng
minh architecture coverage. Audit này không chạy lại các regression suites vì
không đổi runtime code và không suy diễn kết quả cũ là runtime proof hiện tại.

## Trade-offs cần giữ khi tiếp tục

- Product write ports dùng opaque TResult để giữ legacy response. Core không
  inspect ProductRecord, nên đây là trade-off có chủ ý, chưa phải core import SDK.
- Conditional writes, category index maintenance, transactions, SDK cancellation
  decoding nằm ở persistence adapter là đúng trách nhiệm; không chuyển vào core.
- Provider signature parsing, VNPay response codes và URL encoding có thể ở
  adapter; chỉ di chuyển quyết định nghiệp vụ độc lập provider.
- Thay tên file, tạo đủ bốn folder hoặc thêm interface không làm coupling biến mất.
- Scan cost/pagination/completeness là vấn đề access pattern riêng; thêm port
  không tự cải thiện throughput hoặc consistency.

## Thứ tự đề xuất cho đợt migrate tiếp theo

1. Email + notification orchestration: delivery eligibility, durable identity,
   ambiguous publish/send và recovery; giữ nguyên idempotency/retry contracts.
2. Profile/authorization và Cognito business policies: cùng một policy account
   status/ownership có thể dùng từ HTTP lẫn trigger, với database/provider ports.
3. Sales campaign lifecycle: state/version rules, scheduling và compensation.
4. Reports/cleanup và các read/admin-review flows còn lại: read models, retention,
   pagination/backlog cùng những semantic guarantees cần giữ.
5. Admin ops/audit enrichment/upload policies: tách theo độ phức tạp và giá trị
   kiểm thử; giữ các phần thuần kỹ thuật là outer adapters.
6. Mở rộng coverage gate: inventory use cases/entrypoints, exceptions có chủ đích,
   nested core và controller dependency rules; không chỉ tăng số file lint.

Tiêu chí chốt toàn bộ migration: mọi flow nghiệp vụ trong inventory có nơi đặt
policy/orchestration rõ ràng, output dependency qua business contract, entrypoints
chỉ làm transport, và các ngoại lệ kỹ thuật được ghi rõ. Không cần tất cả file
backend nằm trong application/domain hoặc tất cả endpoint có entity class.
