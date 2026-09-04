# Hướng dẫn đọc Backend từ con số 0

Backend nằm ở `apps/api`. Đây là một NestJS application chạy với Fastify. Khi chạy local, nó mở HTTP server. Khi deploy AWS, cùng business code đó được đóng gói thành nhiều AWS Lambda: Lambda nhận HTTP request, SQS message, hoặc lịch chạy định kỳ.

## Bức tranh tổng thể

```text
Client (web / VNPay / AWS event)
        |
        v
entrypoints  ->  Controller  ->  Service  ->  Repository  -> DynamoDB
                              ->  integrations -> SQS / SES / S3 / EventBridge
```

- `Controller` nhận HTTP request, validate input và trả HTTP response. Không nên đặt business rule nặng ở đây.
- `Service` là nơi chứa business rule, ví dụ kiểm tra tồn kho trước khi cập nhật hoặc tạo checkout.
- `Repository` chỉ lo đọc/ghi DynamoDB. Nó không nên biết HTTP request hay `@Controller`.
- `Integration` là adapter gọi dịch vụ AWS bên ngoài. Nhờ tách ra, code nghiệp vụ không bị dính chi tiết AWS SDK.

Ví dụ request `GET /api/shopping-items` đi qua `ShoppingController.listShoppingItems` -> `ShoppingService.listShoppingItems` -> `shopping.repository.listShoppingItems` -> DynamoDB. Mỗi layer có một trách nhiệm, nên debug cũng theo đúng đường này.

## Cấu trúc thư mục hiện tại: chia theo module/feature

Đúng: backend hiện tại chia **theo business module/feature**, không chia ngang toàn cục thành một folder `controllers/`, một folder `services/` và một folder `repositories/`.

Đây là lựa chọn nên giữ. Mỗi feature tự chứa controller, service và repository của chính nó:

```text
modules/
  shopping/
    shopping.controller.ts
    shopping.service.ts
    shopping.repository.ts
    shopping.schema.ts
    shopping.module.ts
  storefront/
    storefront.controller.ts
    storefront.service.ts
    storefront.repository.ts
    storefront.schema.ts
    storefront.module.ts
```

Vì sao không chuyển thành cấu trúc bên dưới?

```text
# Không khuyến nghị khi dự án đã có nhiều feature
controllers/shopping.controller.ts
controllers/storefront.controller.ts
services/shopping.service.ts
services/storefront.service.ts
repositories/shopping.repository.ts
repositories/storefront.repository.ts
```

Với cấu trúc chia ngang, khi sửa flow checkout bạn phải nhảy qua ít nhất ba folder lớn. Khi feature tăng lên, mỗi folder sẽ chứa hàng chục file không liên quan trực tiếp. Cấu trúc hiện tại vẫn có **folder/controller/service/repository**, nhưng đặt chúng *bên trong từng module*; đây là cách cân bằng tốt giữa dễ học và maintainability.

Quy ước khi thêm feature mới: tạo `modules/<feature>/`, sau đó thêm `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`, `<feature>.schema.ts`, `<feature>.module.ts` khi cần. Không tạo root folder `services` hoặc `controllers` mới.

```text
apps/api/
  src/
    core/app/
    config/
    common/
    database/dynamodb/
    modules/
    integrations/
    entrypoints/
    lambda/                 # wrapper cũ, giữ tương thích khi chuyển cấu trúc
    scripts/
    server.ts
  scripts/
infra/
apps/web/
docs/
```

### `apps/api/src`

| Folder / file | Công dụng |
| --- | --- |
| `core/app` | Điểm khởi tạo Nest application. `app.module.ts` ghép các feature module; `create-app.ts` cấu hình Fastify, CORS, validation, exception filter. |
| `config` | Đọc và validate environment variables, ví dụ table name, AWS region, payment config. Không nên đọc `process.env` rải rác trong service. |
| `common` | Code dùng chung: Cognito authentication, logger, cache TTL, exception filter. Không chứa rule riêng của product/order. |
| `database/dynamodb` | DynamoDB client và hàm tạo key. Ví dụ `keys.product(id)` bảo đảm mọi chỗ dùng cùng format `PK`/`SK`. |
| `modules` | Các feature theo nghiệp vụ. Mỗi module thường có `controller`, `service`, `repository`, `schema`, `module`. Đây là nơi nên đọc đầu tiên khi muốn hiểu một chức năng. |
| `integrations` | Client/adapter cho AWS: SQS, SNS, SES, EventBridge. `order-mailer` là ví dụ adapter gửi email đơn hàng. |
| `entrypoints/http` | Entry point chạy API local bằng HTTP server. |
| `entrypoints/lambda/http` | Lambda nhận API Gateway request, ví dụ public API, admin API, VNPay API. |
| `entrypoints/lambda/queue` | Lambda worker nhận message từ SQS. Vì SQS có thể retry, service/worker phải xử lý idempotency. |
| `entrypoints/lambda/jobs` | Lambda chạy theo schedule, ví dụ dọn dữ liệu, báo cáo tồn kho hằng ngày. |
| `entrypoints/lambda/shared` | Factory dùng chung cho Lambda HTTP và queue, tránh copy bootstrap code. |
| `lambda` | Wrapper/handler cũ để tương thích khi project chuyển sang `entrypoints`; không nên thêm feature mới vào đây. |
| `scripts` | Lệnh vận hành thủ công: tạo/seed/reset table, backfill/localize product, test email. Không chạy trong HTTP request. |
| `server.ts` | File khởi động local development server. |

### Các business module quan trọng

| Module | Chịu trách nhiệm |
| --- | --- |
| `shopping` | Admin CRUD product, filter, pagination, stock increment. |
| `storefront` | Product public, checkout gate, order của khách; có logic chống oversell/reservation. |
| `vnpay` | Tạo URL thanh toán, xác minh callback/IPN và payment session. |
| `notifications` | Tạo, đọc, xóa notification và xử lý notification queue. |
| `uploads` | Tạo presigned S3 upload URL và xử lý upload worker. |
| `sales` | Sale campaign và schedule start/end. |
| `inventory-reports` | Tổng hợp/sending low-stock report. |
| `admin-ops` | Thao tác vận hành như inspect DLQ/archive replay. |
| `data-cleanup` | Xóa dữ liệu hết hạn theo job. |
| `health`, `learning` | Health endpoint và chức năng học/demo. |

### Ngoài backend runtime

- `infra`: AWS CDK. File `infra/lib/aws-api-stack.ts` khai báo DynamoDB, Lambda, API Gateway, SQS, Cognito và quyền IAM. Đây là *hạ tầng deploy*, không phải business code.
- `apps/web`: frontend Next.js gọi backend.
- `docs`: tài liệu vận hành/triển khai.
- `scripts`: script PowerShell ở root để deploy hoặc test luồng AWS.

## Quy tắc đặt tên áp dụng

Không nên ép mọi hàm đọc dữ liệu dùng `get`. `get` phù hợp khi lấy **một** resource xác định; collection nên dùng `list`, vì người đọc biết ngay kết quả là nhiều phần tử.

| Ý định | Mẫu tên | Ví dụ trong code |
| --- | --- | --- |
| Lấy một resource bằng identifier | `get<Entity>ById` | `getShoppingItemById(id)` |
| Lấy một collection | `list<Entities>` | `listShoppingItems(query)` |
| Lấy toàn bộ theo nhiều page | `listAll<Entities>` | `listAllShoppingItems(pageLimit, maxPages)` |
| Tính/lấy metadata cụ thể | `get<Entity><Thing>` | `getShoppingItemsPageCursor(...)`, `getShoppingItemMetadata()` |
| Tạo | `create<Entity>` | `createShoppingItem(input)` |
| Cập nhật | `update<Entity>` | `updateShoppingItem(id, patch, version)` |
| Thay đổi một giá trị cụ thể | `<verb><Entity><Target>` | `incrementShoppingItemField(...)` |
| Xóa | `delete<Entity>` | `deleteShoppingItem(id)` |
| Kiểm tra boolean | `is/has/can/should...` | `isCheckoutExpired(...)`, `canReserveStock(...)` |

Tên cần trả lời được: **tác động lên entity nào**, **làm hành động gì**, và nếu có identifier thì **dựa trên gì**. Tránh tên mơ hồ như `list`, `create`, `update`, `remove` ở service vì khi IDE hiển thị một mình, người đọc không biết nó thao tác với gì.

## Thay đổi refactor đã thực hiện

Trong shopping feature, các method generic đã được đổi thành tên theo domain, không thay đổi route hay HTTP contract:

| Trước | Sau | Lý do |
| --- | --- | --- |
| `getShoppingItemAll` | `listAllShoppingItems` | Trả collection qua nhiều DynamoDB pages, nên dùng `list`. |
| `getCursorForPage` | `getShoppingItemsPageCursor` | Nêu rõ cursor là của shopping items. |
| `list` / `listAll` | `listShoppingItems` / `listAllShoppingItems` | Người đọc biết entity ngay tại call site. |
| `getById` | `getShoppingItemById` | Nêu rõ entity và identifier. |
| `create`, `update`, `remove` | `createShoppingItem`, `updateShoppingItem`, `deleteShoppingItem` | Nhất quán CRUD và tránh `remove` mơ hồ. |

## Thứ tự nên đọc để hiểu nhanh

1. Đọc `core/app/app.module.ts` để biết hệ thống có module nào.
2. Chọn một flow nhỏ, nên bắt đầu với `shopping`: `shopping.controller.ts` -> `shopping.service.ts` -> `shopping.repository.ts`.
3. Đọc `database/dynamodb/keys.ts` rồi quan sát repository gọi DynamoDB như thế nào.
4. Đọc `storefront` sau, vì checkout/order có queue, payment và concurrency nên phức tạp hơn.
5. Cuối cùng đọc `entrypoints` và `infra` để hiểu cùng code được đưa lên AWS như thế nào.

Khi debug, bắt đầu từ route/controller, lần theo service rồi repository/integration. Đừng mở toàn bộ `storefront.service.ts` ngay từ đầu: hãy tìm đúng method mà controller hoặc worker gọi tới.

## Bản đồ các flow chính

Phần này là “mục lục để đọc code”. Mỗi flow liệt kê file cần mở theo thứ tự và function quan trọng. Không cần đọc mọi private function ngay ở lần đầu.

### 1. Admin quản lý product

```text
HTTP /api/shopping-items
  -> ShoppingController
  -> ShoppingService
  -> shopping.repository
  -> DynamoDB
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/shopping/shopping.controller.ts` | `listShoppingItems`, `getShoppingItemById`, `createShoppingItem`, `updateShoppingItem`, `incrementShoppingItemField`, `deleteShoppingItem` | Nhận API CRUD admin, validate params/body. |
| `modules/shopping/shopping.service.ts` | Các function cùng tên controller | Áp business rule; khi sửa stock, `ensureStockCanCoverReservations` chặn stock thấp hơn lượng đang checkout reserve. |
| `modules/shopping/shopping.repository.ts` | `listShoppingItems`, `listAllShoppingItems`, `getShoppingItem`, `createShoppingItem`, `updateShoppingItem`, `incrementItemValue`, `deleteShoppingItem` | Query/Update DynamoDB và pagination cursor. |
| `modules/shopping/shopping.schema.ts` | `createShoppingItemSchema`, `updateShoppingItemSchema`, `normalizeCategory` | Validate và chuẩn hóa product data. |

Điểm cần nhớ: Controller chỉ điều phối. Quy tắc “không được hạ stock thấp hơn reserved stock” nằm ở Service; code DynamoDB nằm ở Repository.

### 2. Khách xem product public

```text
GET /api/storefront/products[/id]
  -> ProductsPublicController hoặc StorefrontController
  -> StorefrontService
  -> storefront.repository + shopping.repository
  -> DynamoDB
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/storefront/products-public.controller.ts` | `listProducts`, `getProductById` | Public product endpoints. |
| `modules/storefront/storefront.controller.ts` | `listProducts`, `getProductById` | Storefront HTTP endpoints. |
| `modules/storefront/storefront.service.ts` | `listProducts`, `getProductById` | Parse public query, shape product data và ghép sale campaign đang active. |
| `modules/storefront/storefront.repository.ts` | `listStorefrontProducts`, `getStorefrontProductById` | Lớp truy cập product dành cho storefront. |
| `modules/sales/sales.repository.ts` | `listActiveSaleCampaigns` | Lấy campaign còn hiệu lực để tính giá hiển thị. |

### 3. Checkout và tạo order (flow phức tạp nhất)

```text
POST /checkout/prepare
  -> StorefrontService.prepareCheckout
  -> createCheckoutGateRequest + gửi SQS FIFO
  -> checkout-gate worker
  -> reserve stock / tạo order / gửi event
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/storefront/storefront.controller.ts` | `prepareCheckout`, `getCheckoutStatus`, `createCheckoutPaymentSession`, `cancelCheckout`, `createOrder`, `listMyOrders` | HTTP API checkout và order. |
| `modules/storefront/storefront.service.ts` | `prepareCheckout`, `getCheckoutGateStatus`, `processCheckoutGateRecords`, `resolveCheckoutGate`, `finalizeQueuedOrder`, `precheckProducts`, `cancelCheckout` | Điều phối checkout, kiểm tra product, reserve stock, xử lý queue và finalization. |
| `modules/storefront/storefront.repository.ts` | `createCheckoutGateRequest`, `createCheckoutReservations`, `createStorefrontOrder`, `updateCheckoutGateRequestStatus`, `listOrdersByCustomer` | Persist checkout gate, reservation và order trong DynamoDB. |
| `entrypoints/lambda/queue/checkout-gate-worker.ts` | `handler` | AWS Lambda entrypoint cho SQS FIFO checkout queue. |
| `entrypoints/lambda/shared/queue-factory.ts` | `createQueueHandler` | Bootstrap Nest context và route SQS records đến Service tương ứng. |

Checkout dùng queue để serialize các request tranh cùng tồn kho. Vì SQS có thể retry, các bước phải idempotent: cùng một message chạy lại không được tạo order hoặc trừ stock lần hai.

### 4. Thanh toán VNPay

```text
Create payment session
  -> VnpayService.createPaymentUrl
  -> customer thanh toán tại VNPay
  -> VNPay return/IPN
  -> VnpayService.verifyReturn hoặc verifyIpn
  -> event / notification / order finalization
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/vnpay/vnpay.controller.ts` | `createPayment`, `handleReturn`, `handleIpn` | Nhận request tạo payment và callback từ VNPay. |
| `modules/vnpay/vnpay.service.ts` | `createPaymentUrl`, `verifyReturn`, `verifyIpn`, `handlePaymentEvent`, `finalizeExpiredPayment`, `finalizeFailedPayment` | Ký URL, verify checksum, xử lý trạng thái payment. |
| `modules/vnpay/vnpay.repository.ts` | `createPaymentSession`, `getPaymentSessionByTxnRef`, `updatePaymentSessionStatus` | Lưu payment session, chống xử lý trùng transaction. |
| `entrypoints/lambda/http/payment-vnpay.ts` | `handler` | Lambda HTTP dành cho VNPay API. |

`return` là redirect qua browser, còn `IPN` là callback server-to-server. Không được tin dữ liệu từ browser return trước khi verify checksum và trạng thái session.

### 5. Notification và email

```text
Business event (order/payment/stock)
  -> NotificationsService.createPendingNotification
  -> SQS/EventBridge
  -> notification worker
  -> DynamoDB notification + SES email (nếu cần)
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/notifications/notifications.controller.ts` | `listMyNotifications`, `markAsRead`, `remove`, `removeAll` | API notification của user. |
| `modules/notifications/notifications.service.ts` | `createPendingNotification`, `publishPaymentCompletedEvent`, `publishPaymentFailedEvent`, `publishInventoryStockAlert`, `processQueueRecords`, `completeOrderIfReady` | Tạo và xử lý notification/event; hoàn tất order khi các điều kiện đã đủ. |
| `modules/notifications/notifications.repository.ts` | `createNotification`, `listNotificationsByCustomer`, `deleteNotification`, `deleteNotifications` | Lưu và query notification. |
| `integrations/ses/*-mailer.ts` | `send...` mailer functions | Gửi email qua AWS SES. |
| `entrypoints/lambda/queue/notification-worker.ts` | `handler` | Worker nhận notification queue. |

### 6. Upload ảnh product/avatar

```text
POST /uploads/presign
  -> UploadsService.createPresignedUpload
  -> trả presigned URL
  -> browser upload thẳng lên S3
  -> S3 event / queue worker xử lý tiếp (nếu có)
```

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/uploads/uploads.controller.ts` | `createPresign`, `createAvatarPresign` | Nhận request xin URL upload. |
| `modules/uploads/uploads.service.ts` | `createPresignedUpload`, `processQueueRecords`, `processQueueRecord` | Kiểm tra quyền/file rồi tạo URL; xử lý message upload background. |
| `entrypoints/lambda/queue/image-upload-worker.ts` | `handler` | Worker cho message ảnh upload. |

Browser upload thẳng S3, không upload file qua API server. Điều này giảm tải Lambda/API và tránh timeout với file lớn.

### 7. Sale campaign

| File | Function chính | Công dụng |
| --- | --- | --- |
| `modules/sales/sales.controller.ts` | `list`, `listProducts`, `create`, `removeProduct`, `cancel` | API quản lý campaign. |
| `modules/sales/sales.service.ts` | `list`, `listProducts`, `create`, `cancel`, `removeProduct`, `handleScheduleEvent`, `getActiveCampaigns` | Tạo/cancel campaign, tạo lịch start/end trên AWS Scheduler. |
| `modules/sales/sales.repository.ts` | `createSaleCampaign`, `getSaleCampaign`, `listSaleCampaigns`, `listActiveSaleCampaigns`, `updateSaleCampaignProducts` | Lưu và query campaign. |
| `entrypoints/lambda/jobs/sale-campaign-worker.ts` | `handler` | Xử lý event start/end campaign theo lịch. |
