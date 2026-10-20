# Clean Architecture — Phase 2: Product mutations

## Kết quả và phạm vi

Đã chuyển ba flow còn lại của shopping sang application use cases:

- `POST /api/shopping-items` -> CreateProduct.
- `PATCH /api/shopping-items/:id/increment` -> IncrementProductField.
- `DELETE /api/shopping-items/:id` -> DeleteProduct.

UpdateProduct của Phase 1 tiếp tục hoạt động. API routes, permission checks,
request schemas, category-index transaction và audit middleware được giữ.
Không thay GSI, table schema, queues hoặc CDK resources trong phase này.

## Đường gọi và trách nhiệm

```text
ShoppingController: parse + validate + authentication + permission
  -> ShoppingService: map authenticated principal sang ProductActor
  -> CreateProduct / IncrementProductField / DeleteProduct
      -> domain policy + application access policy
      -> port theo nhu cầu từng use case
          <- DynamoDB adapter
              -> audited rawDb
      -> InventoryAlertPublisher (increment khi cần)
```

Domain/application không import NestJS, Cognito, AWS SDK, ProductRecord hoặc
concrete adapter. Use case nhận actor trung lập, không nhận FastifyRequest.
Permission của HTTP vẫn ở controller; ownership/admin policy của hành động ở
application; điều kiện owner/version tại write ở adapter.

## Các file chính

Các đường dẫn dưới đây tính từ `apps/api/src/modules/shopping/`.

| File | Trách nhiệm |
| --- | --- |
| `domain/counter-policy.ts` | Increment safe integer và clamp về 0 |
| `domain/product.ts` | Thêm ProductCounters và NewProductDetails |
| `application/product-access.ts` | ProductActor và policy tồn tại/owner/admin dùng chung |
| `application/product-mutation.error.ts` | Error model chung cho các product mutations |
| `application/increment-product-field/increment-product-field.ts` | Điều phối increment stock/soldCount, version, status và alert |
| `application/create-product/create-product.ts` | Điều phối tạo, trusted owner, ID/clock, defaults và status |
| `application/delete-product/delete-product.ts` | Đọc/authorize snapshot và yêu cầu conditional delete |
| `application/ports/product-counter-repository.ts` | Contract riêng cho increment |
| `application/ports/product-creator.ts` | Contract riêng cho create |
| `application/ports/product-deleter.ts` | Contract riêng cho delete |
| `infrastructure/persistence/dynamo-product-counter-repository.ts` | Increment transaction và response mapping |
| `infrastructure/persistence/dynamo-product-creator.ts` | Create transaction, giữ legacy response shape |
| `infrastructure/persistence/dynamo-product-deleter.ts` | Marker + audited conditional delete transaction |
| `infrastructure/persistence/product-record.store.ts` | Consistent read, marshalling và conditional error translation dùng chung |
| `shopping.module.ts` | Factory providers cho use cases; ID/clock được inject bằng function |
| `shopping.service.ts` | Facade mỏng cho writes, giữ các query chưa chuyển |

ProductWriteRepository của Phase 1 không bị thêm các method create/increment/delete
mà UpdateProduct không dùng. Notification port mở rộng source `admin.increment`.

## Increment: hành vi và concurrency

- Hỗ trợ cả `stock` và `soldCount`, field có union type.
- Giữ `Math.max(0, current + delta)` thay vì đổi sang reject khi delta âm vượt tồn.
- Delta giữ khoảng -99999..99999 của HTTP schema.
- Domain từ chối fractional/non-finite/unsafe integer và overflow. Không thêm trần
  999999 cho kết quả increment vì flow cũ không có trần này.
- Snapshot version lấy từ server read, không bắt client gửi version mới.
- Adapter đọc lại snapshot; nếu version khác snapshot đã authorize thì conflict.
- Transaction vẫn update product, delete category index cũ và put index mới, với
  existence/version/owner conditions. Không dùng read + unconditional write.
- Không tự retry write hoặc publish. Ambiguous timeout không chứng minh write chưa chạy.
- Stock increment tiếp tục reset alert marker kể cả delta 0 hoặc clamp không đổi
  giá trị, đúng semantics cũ của endpoint increment.
- Khi status chuyển sang low/out và khác trước, publish alert sau commit như trước.

### Sửa lỗi riêng trong phase này

Trước đây merged response và category-index snapshot luôn xóa inventoryAlertSentAt,
kể cả khi increment soldCount, nhưng product UpdateExpression chỉ xóa khi field=stock.
Đã sửa để soldCount giữ alert timestamp ở cả record/index/response. Có regression
test kiểm tra nhất quán ba biểu diễn; stock vẫn reset marker/timestamp như trước.

## Create: hành vi được giữ

- ID được cấp bằng randomUUID qua function injection; timestamps từ clock injected.
- Owner lấy từ authenticated principal, không tin các field metadata trong body.
- HTTP schema tiếp tục kiểm tra toàn bộ field và strip unknown fields. Application
  bổ sung kiểm tra stock/identity và normalize defaults, không nhân đôi toàn bộ Zod schema.
- Version 1, rating 4.8/soldCount 0/featured false nếu thiếu, stock-derived status,
  originalPrice fallback, inventoryAlertSent=false.
- Product và category index được Put atomically với các điều kiện không tồn tại.
- Giữ response create không có PK/SK khi request HTTP chuẩn; update/increment vẫn
  giữ legacy representation của chúng. Không đổi public DTO trong phase này.
- Không thêm immediate inventory alert, SKU uniqueness hoặc idempotency mới.

## Delete: bảo toàn audit

1. Use case đọc và authorize, truyền expectedVersion + expectedOwnerId.
2. Adapter đọc snapshot lại và kiểm tra version trước khi tạo marker.
3. Ghi auditDeleteOutbox với version/owner condition.
4. Transaction gồm deletionAuditPut, conditional Delete product và Delete category index.

Product và authoritative delete-audit event cùng commit hoặc cùng fail. Marker
vẫn là bước trước transaction như cơ chế cũ, không phải một transaction duy nhất
cho cả quy trình. Test bao gồm marker thất bại, marker thành công/transaction fail,
retry khi cùng snapshot và edit cạnh tranh giữa marker và transaction.

Khi transaction chưa commit, không tạo delete-audit event. Nếu marker đã ghi nhưng
transaction thất bại, marker có thể còn trên record; phase này giữ cơ chế đó, chưa
thêm job recovery marker hoặc tuyên bố recovery cho mọi thao tác xóa ngoài flow này.
Khi retry cần đọc/authorize lại; không áp dụng lại snapshot cũ sau concurrent edit.

## Error model và tương thích

- ProductMutationError dùng chung: INVALID_INPUT, NOT_FOUND, FORBIDDEN, CONFLICT.
- AppExceptionFilter map sang 400/404/403/409; lỗi infrastructure khác vẫn 500.
- ProductUpdateError của Phase 1 được giữ dưới dạng alias cùng constructor để các
  caller/test cũ tiếp tục dùng instanceof. Tên error trong logs nay là ProductMutationError.
- Conditional transaction errors được xét theo đúng vị trí business operation:
  create 0/1, increment/update 0, delete 1. Collision ở audit-event Put không bị nhầm
  thành stale product conflict. Network/throttle/validation/contention vẫn giữ lỗi gốc.
- TResult/representation compatibility của Phase 1 tiếp tục được giữ; application
  không đọc persistence metadata trong representation.

## Cleanup

- Bỏ write orchestration, owner-check helper và inventory-alert helper cũ khỏi ShoppingService.
- Chuyển transaction implementation khỏi shopping.repository.ts; không giữ hai bản logic.
- Giữ compatibility exports createShoppingItem/updateShoppingItem/incrementItemValue/
  deleteShoppingItem để seed, reseed, maintenance scripts và audit callers dùng chung helpers.
- Giữ repository/query code vì storefront, sales, vnpay và inventory reports còn dùng.
- Không xóa controller/schema/module; chúng còn trách nhiệm hợp lệ.
- Create controller map rõ property category sau Zod parse để làm việc với inferred
  preprocess type trong strict:false hiện tại; runtime validation không bị bỏ qua.

## Kiểm chứng

Chạy tại `apps/api`:

```powershell
npm run typecheck
npm run test:shopping
npm run test:audit
```

- Shopping: 26 tests, gồm 13 nhóm Phase 1 và 13 nhóm Phase 2.
- Audit regression: 28 tests (21 audit-log và 7 audit-actor-context).
- TypeScript build và typecheck riêng hai file shopping tests.
- Compiled NestJS/Fastify HTTP tests: DI, schemas, permissions, owner/admin, 201/200/204,
  response shape, spoofed fields, conflict/infrastructure errors và audit actor.
- SDK middleware transport tests: transaction payload, conditional model, index,
  alert markers và retry/failure paths. Audit middleware thực chạy trước fake transport.

Docker daemon chưa hoạt động tại thời điểm triển khai: chưa chạy DynamoDB Local.
Database transport và notification publisher được giả lập; test không chứng minh
DynamoDB expression execution hoặc isolation trên AWS. Chưa deploy, chưa kiểm chứng
Cognito token thật, Streams delivery hoặc EventBridge delivery.

## Giới hạn còn lại

- Create/increment chưa có idempotency contract: request mới có thể tạo lại/cộng lại.
- Publish alert vẫn sau commit; lỗi publish có thể làm request fail dù dữ liệu đã lưu.
- Delete marker có thể còn sau transaction failure; cần xử lý theo recovery policy
  riêng nếu vận hành yêu cầu mạnh hơn cơ chế hiện tại.
- List/search, manual-index-to-GSI migration, checkout/payment/refund và public DTO
  redesign không thuộc phase này.
