# Kế hoạch Clean Architecture — Phase 2

Đã triển khai trong source và kiểm chứng local. Xem
[báo cáo thực hiện](clean-architecture-phase-2.md) để biết thay đổi, test results
và giới hạn bằng chứng; chưa deploy hoặc kiểm chứng DynamoDB thực.

## Mục tiêu và phạm vi

Chuyển các flow ghi còn lại của shopping sang use case: increment field, create
product và delete product. Giữ Phase 1 UpdateProduct hoạt động, request/response
hiện tại, transaction category index, permission và audit. Đây là kế hoạch dựa
trên source local; không phải xác nhận hành vi AWS đã được kiểm chứng.

Không gộp việc đổi manual category index sang GSI, checkout/refund, list/search,
đổi public DTO hoặc triển khai một hệ thống idempotency tổng quát vào phase này.

## Thứ tự thực hiện

| Đợt | Công việc | Điều kiện hoàn thành |
| --- | --- | --- |
| 2A | Baseline và IncrementProductField | stock/soldCount, clamp, concurrency, alert và response được kiểm tra |
| 2B | CreateProduct | owner, ID/time, defaults, transaction và response tương thích |
| 2C | DeleteProduct | owner/version, category index và audit delete/outbox được kiểm tra |
| 2D | Cleanup và regression | caller được rà soát, bỏ code chết và test lại Phase 1 |

Mỗi đợt là một thay đổi có thể review riêng. Tách các sửa lỗi nghiệp vụ phát hiện
được thành thay đổi rõ ràng, không ngầm đổi behavior trong lúc di chuyển code.

## 2A — IncrementProductField

### Baseline từ source hiện tại

- Endpoint hỗ trợ cả stock và soldCount, không chỉ stock.
- Controller validate field và incrementBy; service đọc và kiểm tra owner/admin.
- Repository đọc lại sản phẩm, tính Math.max(0, currentValue + incrementBy).
- Không nhận expectedVersion từ client; dùng version snapshot đọc từ database.
- Transaction kiểm tra version/owner và cập nhật product + category index.
- Stock increment reset alert marker; service phát alert khi đổi sang low/out.
- Không có idempotency key cho thao tác increment hiện tại.

### Thiết kế đích

- Use case: application/increment-product-field/increment-product-field.ts.
- Command field dùng union 'stock' | 'soldCount', không nhận string tùy ý.
- Domain policy tính next value theo clamp hiện tại; stock policy dùng chung.
- Port giữ conditional update theo snapshot và ownership, adapter thực hiện
  transaction. Không thay bằng read rồi write không điều kiện.
- Không tự retry write không rõ kết quả: một request mới có thể cộng thêm lần nữa.
- InventoryAlertPublisher cần hỗ trợ source admin.increment với semantics rõ ràng.
- Mở rộng business projection/port theo dữ liệu cần cho soldCount, không truyền
  nguyên ProductRecord vào application.

### Điểm cần quyết định trước khi merge

Giữ clamp về 0 trong refactor, trừ khi có quyết định đổi sang reject. Kiểm tra
safe integer/overflow và giới hạn giá trị kết quả; không tự áp dụng giới hạn của
PATCH set-stock vào increment vì behavior hiện tại khác nhau.

Repository đang xóa inventoryAlertSentAt khỏi merged response/index ngay cả khi
increment soldCount, nhưng UpdateExpression chỉ REMOVE timestamp khi field là
stock. Cần regression test và tách một sửa lỗi rõ ràng nếu xác nhận dữ liệu lệch;
đề xuất giữ nguyên alert metadata cho soldCount để record/index/response nhất quán.

### Test

- Owner/admin/other owner, missing product; field/increment không hợp lệ.
- Stock và soldCount; positive/negative/zero delta; clamp về 0; status boundaries.
- Version/owner thay đổi sau khi đọc; hai writer cùng snapshot.
- Index transaction, alert metadata, audit actor và response.
- Publish thất bại sau commit; không tự ghi lại hay publish lại.

## 2B — CreateProduct

- Use case điều phối actor, dữ liệu tạo sản phẩm, status, ID và thời gian.
- Có thể inject function tạo ID/clock để test, chưa cần dựng nhiều abstraction.
- Ownership lấy từ authenticated actor, không lấy từ request body.
- Adapter giữ transaction Put product + Put category index và các điều kiện
  attribute_not_exists hiện tại.
- Giữ version 1, defaults, originalPrice fallback và inventoryAlertSent=false.
- Giữ response create hiện tại: không tự thêm PK/SK chỉ vì update trả chúng.
- Không thêm immediate inventory alert: flow create hiện tại không publish alert.
- Không tự thêm business constraint như SKU unique khi source chưa có contract đó.

Test permission, spoofed owner/id/metadata, defaults/status, transaction conflict,
audit actor, response shape và lỗi hạ tầng. Retry create có thể tạo sản phẩm khác
vì ID mới; không tuyên bố exactly-once nếu chưa có idempotency contract.

## 2C — DeleteProduct

- Use case kiểm tra tồn tại, owner/admin và yêu cầu xóa conditional.
- Adapter giữ version/owner condition, category index deletion và deletionAuditPut.
- Quy trình hiện tại có bước đánh auditDeleteOutbox trước transaction xóa; không
  thay bằng DeleteItem độc lập hoặc bỏ marker vì nhìn có vẻ dư thừa.
- Giữ HTTP 204 và hành vi not-found/forbidden/conflict theo contract đã thống nhất.
- Phân loại conditional errors khác với network/throttling/validation errors.

Test concurrent edit sau read, đổi owner, missing record, product/index/audit
transaction, marker write thất bại, marker thành công nhưng delete transaction
thất bại và hành vi retry. Chứng minh audit không bị lặp hoặc mất theo cơ chế hiện
có; nếu phát hiện lỗ hổng thì sửa riêng và kiểm chứng trước khi merge.

## 2D — Cleanup và compatibility

- Giữ controller/schema/module làm HTTP boundary và composition root.
- ShoppingService có thể tiếp tục là facade cho query chưa chuyển.
- Bỏ assertCanManageProduct/publishInventoryAlertIfNeeded trong service chỉ khi
  không còn caller và các use case mới đã đảm nhận đủ hành vi.
- Chuyển transaction implementation thay vì sao chép logic sang file mới.
- Rà soát imports ở scripts, storefront, vnpay, sales, inventory reports trước
  khi bỏ export của shopping.repository.ts.
- Giữ compatibility wrapper nếu còn caller; không xóa nguyên repository vì còn
  list/search/reporting và những flow ngoài phạm vi.
- Port có thể tách thành contract hẹp theo nhu cầu caller; không mở rộng thành
  generic repository mọi thao tác hoặc bắt UpdateProduct mock thêm method không dùng.

## Kiểm chứng và rollout

1. Domain/use-case tests cho rules và các nhánh thất bại.
2. Adapter tests cho command payload và error mapping; ghi rõ nếu dùng fake transport.
3. HTTP tests với compiled Nest module: DI, validation, permission và response.
4. Chạy typecheck/build, test:shopping và test:audit của Phase 1.
5. Khi có DynamoDB Local/test environment: kiểm tra expressions, transaction/index
   và concurrency trên database thực. Fake transport không thay thế bằng chứng này.
6. Kiểm tra diff để không đổi database schema, queue contract hoặc CDK resources
   ngoài phạm vi. Nếu cần thay đổi chúng, mở rộng review và kiểm chứng tương ứng.

Mỗi đợt chỉ hoàn tất khi hành vi đã được kiểm chứng ở mức ghi rõ, imports của
application không đi vào SDK/framework/adapter và các giới hạn runtime được báo cáo.
