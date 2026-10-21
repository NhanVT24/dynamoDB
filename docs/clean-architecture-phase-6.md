# Phase 6 — Storefront read flows và notification completion

## 1. Phạm vi và kết quả

Phase này chuyển các query có policy dành cho khách hàng và quy tắc hoàn tất
legacy order vào application. Không chuyển mọi query admin thành một use case
chỉ để có thêm folder. Không deploy hoặc sửa table/index/IAM trong phase này.

| Flow | Application | Output port | Adapter |
| --- | --- | --- | --- |
| Danh sách product công khai | `ListProducts` | `CatalogReader` | `DynamoCatalogReader` |
| Chi tiết product công khai | `GetProduct` | `CatalogReader` | `DynamoCatalogReader` |
| Chi tiết order của customer | `GetOrderDetails` | `OrderReader` | `DynamoOrderReader` |
| Danh sách order của customer | `ListMyOrders` | `OrderReader` | `DynamoOrderReader` |
| Hoàn tất legacy order sau system notification | `CompleteNotifiedOrder` | `NotifiedOrders` | `DynamoNotifiedOrders` |

File đều nằm dưới `apps/api/src/modules`. Các query storefront trước đây gọi
repository trực tiếp trong `StorefrontService`; nay service nhận request đã
validate và chuyển tới các application classes. Service vẫn là adapter bên
ngoài vì sử dụng Nest, Zod và định dạng queue message.

## 2. Những hành vi được bảo vệ và sửa

### Product

- `CatalogProduct` là read projection (dữ liệu phục vụ đọc), không phải bản sao
  nguyên record DynamoDB và cũng không cần là domain entity đầy đủ.
- `DynamoCatalogReader` chuyển record thành projection bằng allowlist. Không
  đưa `PK`, `SK`, ownership, audit fields, version, alert flags vào application.
- `GetProduct` trả NOT_FOUND khi không tồn tại hoặc không có stock dương.
  `ListProducts` ẩn hàng hết stock nhưng giữ nguyên cursor/pageInfo. Một page
  rỗng vẫn có thể có `hasNextPage=true`; client phải tiếp tục theo cursor.
- Trước đây `toPublicProductDetail` dùng `...attributes` để gom mọi field chưa
  destructure; owner/audit metadata hoặc cột mới có thể lọt vào response.
  Nay `attributes` chỉ gồm color, size, material, warrantyMonths, voltage,
  capacityLiters, ageRange, skinType, weightGrams, expiryDate nếu có giá trị.
  Đây là thay đổi response có chủ ý: extension field khác phải được duyệt thêm
  vào contract/mapping, không tự xuất hiện công khai.
- Policy giá sale chuyển vào `sales/domain/sale-pricing.ts`, nhận
  `PricingCampaign` không có persistence fields. Giữ giá thấp hơn giữa giá đang
  bán và campaign; giữ discount và quy tắc chọn campaign cũ. File
  `sales/sale-pricing.ts` còn là compatibility export cho callers hiện tại.
- Dùng lại domain function `deriveStockStatus` cho ngưỡng low/out-of-stock.
  Domain chứa cả data types lẫn business functions, không chỉ interface.

### Order

- `GetOrderDetails` chuẩn hóa id; id rỗng/quá 128 ký tự bị từ chối trước DB.
- Hỗ trợ cả legacy `DETAIL` và checkout `ORDER`. Adapter biết key layout;
  application không import SDK, `AttributeValue` hoặc `PK/SK`.
- Kiểm tra ownership trước khi đọc order items. Thiếu order và order của người
  khác đều trả NOT_FOUND để không tiết lộ order có tồn tại hay không.
- `serverNow` dùng clock được inject, thuận tiện kiểm tra chính xác. Đây là thời
  điểm tạo response, không phải snapshot transaction cho toàn bộ order/items.
- `DynamoOrderReader` chỉ trả field nghiệp vụ. Các field frontend `StoreOrder`
  sử dụng vẫn còn: id, customerEmail, status, items, totalAmount, timestamps,
  paymentConfirmedAt và refund metadata. Raw key/audit metadata không trả nữa.
- `ListMyOrders` lọc lại ownership để phòng adapter trả sai customer. Việc này
  không thay thế điều kiện lọc trong database adapter.

### Notification completion

- Tách `completeOrderIfReady` khỏi `NotificationsService` thành
  `CompleteNotifiedOrder`. Quy tắc hiện có: chỉ legacy order `pending` và có
  system notification `sent` tương ứng mới chuyển sang `done`.
- Checkout order `paid`, refund, expiry không đi qua quy tắc legacy này; payment
  settlement vẫn do `ConfirmOrderPayment` phụ trách.
- `DynamoNotifiedOrders` đọc các scan pages đến khi tìm thấy notification hoặc
  hết dữ liệu, kể cả khi một page bị filter thành rỗng. Dùng strong reads;
  `Scan` nhiều pages vẫn không phải một snapshot transaction.
- Ghi `pending -> done` và status audit trong cùng `TransactWriteItems`, với
  condition status vẫn là pending. Trước đó hai lần ghi rời nhau có thể để lại
  status audit dù update order thất bại.
- Hai worker cùng hoàn tất: chỉ một transaction thắng. Worker còn lại strong
  read thấy done thì ACK an toàn. Mất response sau commit cũng dùng cùng cách
  đọc lại; nếu chưa xác nhận done thì lỗi vẫn được đẩy lên để retry/DLQ.
- Status audit dùng key ổn định `DETAIL#STATUS_CHANGE#done`; replay không tạo
  thêm status audit. Điều này không bảo đảm exactly-once cho email/SNS/EventBridge.
- Response queue `orderCompleted` nay phản ánh completion thực tế, thay vì luôn
  true khi payload chỉ cần có orderId. Payload chưa đủ điều kiện trả false.

## 3. Cấu trúc file và dependency

```text
modules/
├── shopping/domain/
│   ├── product.ts                  business data types
│   └── stock-policy.ts             ngưỡng stock
├── sales/
│   ├── domain/sale-pricing.ts       policy giá, không import repository
│   └── sale-pricing.ts              compatibility export
├── storefront/
│   ├── application/
│   │   ├── ports/catalog-reader.ts  read contract product/campaign
│   │   ├── ports/order-reader.ts    read contract order/items
│   │   ├── read-catalog/read-catalog.ts  ListProducts, GetProduct
│   │   └── read-orders/read-orders.ts    GetOrderDetails, ListMyOrders
│   ├── infrastructure/persistence/
│   │   ├── dynamo-catalog-reader.ts
│   │   └── dynamo-order-reader.ts
│   ├── storefront.service.ts        input adapter/facade
│   └── storefront.module.ts         composition root: tạo và nối objects
└── notifications/
    ├── application/complete-notified-order.ts  use case và port NotifiedOrders
    ├── infrastructure/dynamo-notified-orders.ts
    ├── notifications.service.ts     decode message, delivery/integration
    └── notifications.module.ts      wiring
```

Nhóm theo feature, rồi tách trách nhiệm bên trong; không tạo domain riêng cho
mỗi endpoint. Nhiều use case cùng sử dụng một domain policy/port khi nhu cầu
tương đồng. Không gom mọi thứ dùng lại vào một folder shared khổng lồ:
stock thuộc shopping, pricing thuộc sales, order read projection thuộc storefront.

| Vùng | Được phụ thuộc vào | Không được phụ thuộc vào trong các flow đã chuyển |
| --- | --- | --- |
| Domain | Business types/functions | Application, Nest, AWS SDK, persistence |
| Application | Domain, ports, application errors | Concrete adapters, HTTP exceptions, DynamoDB keys |
| Infrastructure | Ports và domain cần để implement | Không bắt application import ngược nó |
| Controller/service facade | Application, auth/validation/transport | Không đặt policy của flow đã tách vào đây |
| Module | Use cases + concrete adapters | Đây là nơi được biết cả hai để wiring |

Hai bên cùng phụ thuộc `CatalogReader` là **application use case và infra
adapter**. Domain không cần biết application port.

## 4. Ví dụ đầy đủ: GET product detail

Request thực tế: `GET /api/products/<uuid>`; alias
`GET /api/storefront/products/<uuid>` cũng sử dụng cùng use case.

```text
HTTP request
  -> ProductsPublicController.getProductById
       validate/normalize uuid bằng shoppingParamsSchema
  -> StorefrontService.getProductById
  -> GetProduct.execute
       gọi this.catalog.findById(id)
  -> DynamoCatalogReader.findById
  -> shopping.repository.getShoppingItem
  -> DynamoDB GetItem (ConsistentRead=true)
  <- raw ProductRecord
  <- CatalogProduct qua allowlist mapper
  -> GetProduct kiểm tra stock
  -> catalog.activeCampaigns() -> sales repository -> DynamoDB query
  -> resolveSalePrice + domain stock policy + public attributes
  <- public product response
```

Đường **gọi lúc chạy** tới DB đi ra adapter bên ngoài. Đường **import trong
source** của use case không đi ra adapter:

```ts
// application/read-catalog/read-catalog.ts
import type { CatalogReader } from "../ports/catalog-reader.js";
import { resolveSalePrice } from "../../../sales/domain/sale-pricing.js";

export class GetProduct {
  constructor(private readonly catalog: CatalogReader) {}
  // execute gọi this.catalog.findById; không tự new DynamoCatalogReader.
}
```

```ts
// infrastructure/persistence/dynamo-catalog-reader.ts
import type { CatalogReader } from "../../application/ports/catalog-reader.js";
export class DynamoCatalogReader implements CatalogReader {
  // Implement thật bằng các hàm repository/AWS SDK ở vùng ngoài.
}
```

```ts
// storefront.module.ts — wiring thật
{
  provide: GetProduct,
  useFactory: () => new GetProduct(new DynamoCatalogReader())
}
```

Interface không tự tìm implementation và không chạy method. `new
DynamoCatalogReader()` tạo object thật; constructor nhận object đó và lưu trong
`this.catalog`. Khi gọi `this.catalog.findById`, JavaScript gọi method trên
object thật. `implements` chỉ kiểm tra contract khi compile.

`import type` giúp kiểm tra kiểu và bị xóa khỏi JavaScript output. Vẫn là source
dependency và vẫn phải đúng hướng. `resolveSalePrice` là function chạy thật nên
phải import thông thường; import domain function là đúng hướng. `GetProduct` là
class có method execute, đặt tên hành động vì đại diện việc đọc product;
`CatalogProduct` là data type, không cần new.

Giảm phụ thuộc framework nghĩa là thay DynamoDB bằng adapter khác đáp ứng
CatalogReader thì policy của GetProduct vẫn giữ. Không có nghĩa là bỏ AWS SDK,
viết tay HTTP/database driver hoặc luôn thay DB mà không cần migration dữ liệu.

## 5. Cleanup

- Xóa mapper `toPublicProductSummary`, `toPublicProductDetail`, `hasPhysicalStock`
  cũ trong StorefrontService sau khi callers đã chuyển.
- Xóa `listStorefrontProducts` vì chỉ là wrapper và không còn caller.
- Xóa `markOrderAsDone` hai bước ghi cũ; dùng transaction trong adapter mới.
- Xóa `completeOrderIfReady`; worker gọi use case mới.
- Xóa `StorefrontService.finalizeWorkflowOrder` không còn caller; Step Functions
  hiện dùng WorkflowCheckout. Nhánh queue cũ còn caller nên vẫn được giữ.
- Giữ `storefront.repository.ts`, `sales/sale-pricing.ts` và shopping repository
  vì còn callers/scripts/integrations. Không xóa theo tên file cũ.

## 6. Kiểm chứng tại local

Chạy tại `apps/api`:

```powershell
npm run typecheck
npm run test:storefront
npm run test:shopping
npm run test:audit
```

Storefront: 66 tests, gồm 14 tests mới trong `tests/storefront-reads.test.ts`.
Shopping: 26 tests. Audit: 29 tests. Tổng 121 tests.
Có typecheck riêng các test files, kiểm tra dependency imports và git diff.

Tests mới kiểm tra public allowlist, sale/manual price, stock thresholds,
empty-page cursor, DB errors, missing/foreign/invalid order, legacy/checkout
mapping, injected clock, completion policy, notification pagination, concurrent
completion, atomic rollback và lost response. Compiled Nest/Fastify chạy thật
hai product routes, order auth/ownership/error mapping và notification queue
branch chạy lặp; DB/provider transport vẫn fake qua SDK middleware.

Không có DynamoDB expression-engine, AWS deployment hoặc VNPay runtime proof.
Fake xác nhận orchestration và SDK command payloads, không thay thế integration
test trên DynamoDB Local/staging. Windows sandbox chặn child process bằng
spawn EPERM; test runner đã được chạy ngoài sandbox để hoàn tất kiểm tra.

## 7. Những phần còn lại và roadmap

| Phase | Trách nhiệm | Trạng thái |
| --- | --- | --- |
| 1 | UpdateProduct, ownership/version/stock policy, write port và alert adapter | Đã làm |
| 2 | Create, increment, delete product; giữ transaction/index/audit | Đã làm |
| 3 | Cancel, request/refresh/reconcile refund; giữ request identity khi timeout | Đã làm |
| 4 | Checkout, payment verification, worker, workflow, expiry và inventory transaction | Đã làm |
| 5 | Recovery/backlog/checkpoint, atomic payment link, query provider, manual review | Đã làm |
| 6 | Read policies/projections storefront, notification completion, cleanup | Đã làm trong phạm vi trên |
| 7 | Dependency rules trong CI, integration/staging, observability, rollout/rollback | Chưa làm |

Các mục cần tiếp tục đánh giá, không được coi là đã giải quyết chỉ nhờ tách lớp:

1. `listOrdersByCustomer` vẫn scan lịch sử toàn table và enrich items từng order.
   `DynamoNotifiedOrders` vẫn scan notification pages. Cần access pattern theo
   customer/order, pagination và migration/backfill phù hợp; chưa có index theo
   customer đáp ứng hai nhu cầu này. Thêm port không làm Scan rẻ hoặc nhanh hơn.
2. Product read vẫn dùng query engine cũ: một số filters dùng Scan, sort có thể
   gom nhiều pages rồi sort trong memory. Cần đo cardinality/RCU/latency và giới
   hạn dữ liệu trước khi thay strategy. GSI đọc eventual, detail strong read;
   product và campaign không nằm trong cùng snapshot.
3. Shopping admin/demo reads vẫn ở outer service; owned-products còn giới hạn
   lấy tối đa 20 pages trước khi filter owner. Nếu cần completeness/scalability,
   thiết kế read access pattern riêng thay vì chỉ bọc thêm interface.
4. NotificationsService vẫn giữ routing, notification CRUD và nhiều integration
   effects; Phase 6 chỉ tách business rule completion. Chưa chuẩn hóa toàn bộ
   delivery/retry/idempotency của failed-payment email/system notification.
5. Completion legacy dựa vào system notification sent là hành vi cũ được giữ;
   nếu business muốn fulfillment thật, phải thiết kế state machine và tín hiệu
   fulfillment, không coi notification delivery là bằng chứng giao hàng.
6. Cần DynamoDB integration kiểm tra expression/cancellation/atomicity, IAM,
   payload contracts trên staging; review metrics/alarms, rollout nhỏ và khả
   năng quay lại version trước. Phase 7 không tự động có nghĩa là deploy production.
