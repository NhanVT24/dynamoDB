# Clean Architecture — Phase 1: UpdateProduct

## Phạm vi

Chuyển luồng `PATCH /api/shopping-items/:id` sang use case độc lập NestJS/AWS SDK.
Giữ permission tại controller, request schema, response cũ, transaction, inventory
alert và audit context. Chưa chuyển create, increment, delete, checkout hoặc refund.

## Luồng trước và sau

Trước:

```text
ShoppingController
  -> ShoppingService: đọc sản phẩm, kiểm tra owner/admin, update, phát alert
  -> shopping.repository.ts: business policy + mapping + DynamoDB transaction
```

Sau:

```text
ShoppingController: authentication, permission, Zod validation
  -> ShoppingService: map principal sang actor, gọi use case
  -> UpdateProduct: kiểm tra quyền, version, stock policy, điều phối write/alert
      -> ProductWriteRepository port
          <- DynamoProductWriteRepository
              -> audited rawDb -> DynamoDB
      -> InventoryAlertPublisher port
          <- NotificationsInventoryAlertPublisher
              -> NotificationsService hiện có
```

Mũi tên gọi runtime có thể đi ra adapter. Source dependency của application chỉ
đi đến domain và các port của application; không import concrete adapter.

## Cấu trúc và trách nhiệm

| File | Trách nhiệm |
| --- | --- |
| `apps/api/src/modules/shopping/domain/product.ts` | Projection nghiệp vụ cần cho update, editable fields và status types; không chứa PK/SK hoặc Cognito principal |
| `domain/stock-policy.ts` | Suy ra `out_of_stock` khi stock <= 0, `low_stock` khi <= 10, còn lại `active` |
| `application/update-product/update-product.ts` | Use case và command; owner/admin, version, stock validation, write và chuyển trạng thái cảnh báo |
| `application/update-product/product-update.error.ts` | Lỗi application độc lập HTTP/AWS |
| `application/ports/product-write-repository.ts` | Contract đọc/ghi, atomicity, ownership, version, index và failure semantics |
| `application/ports/inventory-alert-publisher.ts` | Contract phát inventory alert cho update |
| `infrastructure/persistence/dynamo-product-write-repository.ts` | Strongly consistent read, transaction và chuyển conditional failure thành application conflict |
| `infrastructure/persistence/product.mapper.ts` | Mapping record/domain, search normalization và merge record tương thích |
| `infrastructure/notifications/inventory-alert-publisher.ts` | Chuyển application alert sang NotificationsService |
| `shopping.module.ts` | Composition root: factory provider lắp ráp use case và hai adapter |
| `shopping.service.ts` | Facade tương thích cho controller; các flow chưa chuyển vẫn giữ tại đây |
| `shopping.repository.ts` | Giữ các flow khác; export update cũ chuyển tiếp sang transaction implementation mới cho maintenance scripts |
| `product.types.ts` | Giữ persistence type hiện có; re-export status type/value từ domain |
| `apps/api/src/common/filters/app-exception.filter.ts` | Map application errors sang HTTP response |

Các đường dẫn viết gọn trong bảng thuộc `apps/api/src/modules/shopping/`.

## Từng bước của use case

1. Nhận productId, changes, expectedVersion và actor do caller đã xác thực tạo ra.
2. Kiểm tra identity không rỗng, version nguyên dương và stock nguyên trong
   khoảng 0..999999 nếu có patch stock. HTTP schema hiện có vẫn kiểm tra toàn bộ
   hình dạng, giới hạn và coercion của các field khác.
3. Đọc business projection; không tồn tại -> NOT_FOUND.
4. Non-admin phải là owner; nếu sai -> FORBIDDEN.
5. Version snapshot phải khớp version client gửi; nếu sai -> CONFLICT.
6. Suy ra status qua domain policy.
7. Yêu cầu adapter ghi với expected version và expected owner cho non-admin.
8. Sau commit, nếu chuyển sang low_stock/out_of_stock khác status trước đó,
   await phát alert. Không phát alert khi write thất bại.
9. Trả representation do adapter cung cấp, không đọc metadata của nó.

Input ngoài HTTP vẫn phải được caller validate theo contract. Use case không thay
thế toàn bộ schema validation bằng một bộ schema thứ hai.

## Các bảo đảm persistence được giữ

- Vẫn dùng audited `rawDb`; không tạo DynamoDB client mới.
- Vẫn đọc với `ConsistentRead: true`. Giữ hai lần đọc như luồng cũ; chưa tối ưu
  số request trong cùng đợt refactor.
- Transaction vẫn gồm update product, delete category index cũ, put index mới.
- Update có điều kiện tồn tại + version; non-admin thêm owner condition.
- Tăng version trong write, cập nhật updatedAt, status và search fields.
- Giữ quy tắc fallback originalPrice.
- Chỉ khi giá trị stock thay đổi mới reset inventoryAlertSent và xóa timestamp.
- Adapter trả lỗi CONFLICT cho conditional failure của operation product. Không
  đổi throttling, transaction contention, validation hay network failure thành 409.
- Export update cũ vẫn phục vụ `localize-products.ts` và `update-product-images.ts`;
  các script này không được tự động chuyển thành HTTP use case hoặc phát alert.

Early version check không thay thế conditional write. Nếu owner/version thay đổi
sau khi đọc, database condition mới là điểm quyết định ghi có được chấp nhận.

## Tương thích response và trade-off của TResult

API cũ trả ProductRecord, gồm PK/SK và metadata mở rộng. Phase này không loại bỏ
các field ấy khỏi response vì frontend/caller có thể đang sử dụng chúng.

`ProductWriteRepository<TResult>` trả business projection và một `representation`
có type do adapter bên ngoài quyết định. `UpdateProduct<TResult>` chỉ dùng projection
để ra quyết định, rồi trả nguyên representation. Domain/application không biết tên
ProductRecord, DynamoDB keys, SDK hay HTTP types.

Đây là cơ chế tương thích có chủ đích trong migration, không phải lý do để đưa
PK/SK vào domain hoặc dùng generic repository cho toàn bộ hệ thống. Khi version API
được chuẩn hóa về public DTO, có thể thay representation bằng output model rõ ràng
và mapper ở presentation boundary. Product projection hiện tại chỉ phục vụ update,
chưa phải toàn bộ model cho checkout, sales hay catalog.

## Error mapping

| Trường hợp | HTTP |
| --- | --- |
| HTTP schema validation | 400 với issues như trước |
| INVALID_INPUT từ use case | 400 |
| Không có permission / không phải owner | 403 |
| Sản phẩm không tồn tại khi đọc ban đầu | 404 |
| Stale version / mất sản phẩm hoặc owner condition không khớp lúc ghi | 409 |
| Lỗi hạ tầng không thuộc conditional failure | 500 theo filter hiện có |

NOT_FOUND/FORBIDDEN giữ cấu trúc message/error/statusCode của NestJS. CONFLICT giữ
cấu trúc correlationId/message của conditional error cũ. Transaction cancellation
do điều kiện product nay được nhận diện rõ và trả 409 thay vì rơi vào 500 chung.

## Kiểm chứng

Chạy trong `apps/api`:

```powershell
npm run typecheck
npm run test:shopping
npm run test:audit
```

`test:shopping` compile bằng tsc trước vì HTTP test cần decorator metadata thật
của NestJS. Test gồm 13 nhóm:

- Boundary stock 0/1/10/11; input stock/version/identity không hợp lệ.
- Owner/admin, missing product và stale version.
- Chuyển status cần alert, không phát lại khi cùng status hoặc về active.
- Write failure không phát alert; publish failure sau commit không tự retry.
- Transaction/index payload, version, alert markers và response metadata.
- Audit middleware thực tế đóng dấu actor lên command.
- Hai writer cùng version có một winner trong mô hình conditional transport.
- Owner thay đổi/xóa sản phẩm; giữ nguyên lỗi hạ tầng.
- Maintenance export dùng chung transaction implementation.
- HTTP qua compiled Nest module/Fastify: validation, auth, permission, error mapping,
  actor audit, response cũ và loại bỏ các field không được phép từ body.

### Giới hạn bằng chứng

Database transport và notification publisher được giả lập trong test. SDK middleware,
Nest DI, controller, schemas, use case và filter là code thực. Transport mô phỏng
conditional semantics và kiểm tra command payload; nó không chạy DynamoDB expressions
hoặc chứng minh transaction isolation của AWS.

Docker daemon không hoạt động tại thời điểm triển khai, nên chưa kiểm tra với
DynamoDB Local. Chưa deploy AWS, chưa thực hiện Cognito sign-in hoặc EventBridge
delivery thật. HTTP test bật unverified JWT chỉ trong process test và restore sau đó.

## Rủi ro còn lại

Publish alert vẫn xảy ra sau database commit như trước. Nếu publish lỗi, HTTP request
có thể thất bại dù dữ liệu đã lưu; retry với version cũ sẽ conflict. Tách port không
tạo atomic delivery hoặc tự giải quyết khoảng trống write/publish. Nếu yêu cầu delivery
bền vững, cần thiết kế outbox/CDC và idempotency riêng trong một thay đổi khác.

Create/increment vẫn dùng mapper đã tách và cùng domain stock policy, nhưng chưa
được chuyển sang application use cases. Các quy tắc stock ở storefront chưa được
gom chung vì cần đối chiếu semantics của từng luồng trước.

## Bước tiếp theo

Phase 2 ưu tiên increment stock, rồi create/delete. Tách theo hành vi thật; không
coi increment là set stock vì retry có thể cộng thêm lần nữa. Giữ compatibility
exports đến khi đã chuyển và kiểm tra tất cả caller.
