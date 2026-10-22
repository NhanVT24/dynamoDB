# Hoàn tất các phần còn lại sau audit backend

> Cập nhật 2026-10-22: business behavior tiếp tục được chuyển sang rich entities
> và value objects. Xem [rich domain model](rich-domain-entities.md). Các số liệu
> verification bên dưới là snapshot của đợt migration ngày 2026-10-21.

Ngày: 2026-10-21. Phạm vi: source backend trong workspace; chưa deploy AWS.

## Kết quả và cách đọc cấu trúc

Các capability nghiệp vụ còn thiếu trong audit đã có application boundary và
ports. Domain/application không import NestJS, AWS SDK, config hoặc repository
cụ thể. Composition root cung cấp implementation cho constructor của use case.

Không cần chuyển mọi file sang application/domain. HTTP, Cognito, SNS/SQS,
EventBridge, DynamoDB conditions/transactions, presigning và SES protocol vẫn
thuộc bên ngoài. Những repository, integration và compatibility facade còn caller
được giữ lại có chủ đích.

| Capability | Application/domain mới | Adapter hoặc nơi wiring |
| --- | --- | --- |
| Shopping management reads | `shopping/application/managed-products.ts`: query facade và lọc owner | `shopping/infrastructure/persistence/managed-product-reads.ts`, ShoppingModule |
| Profile | ProfileQueries, UpdateProfile; avatar ownership/default-prefix policy | DynamoProfiles, S3ProfileAvatars; AuthorizationModule |
| User authorization | AuthorizationUseCases; account-status policy, không tự block tài khoản | CognitoUserDirectory, dynamoAuthorizationStore |
| Customer directory | ListVerifiedCustomers: enabled/verified, normalize và deduplicate | searchCustomerCandidates giữ Cognito query/filter serialization |
| Account lifecycle | PrepareSignUp, AccountAccess, ConfirmAccount, ObserveSuccessfulLogin; sign-up email policy | Cognito trigger mapping, provider-linking và SDK persistence ở entrypoint/helpers |
| Sales lifecycle | SalesUseCases và CampaignStore/CampaignProducts/CampaignSchedules | campaign-adapters.ts, SalesModule, sales.composition.ts cho Lambda |
| Notifications | NotificationUseCases: ownership/visibility, CRUD, inventory/payment orchestration | notification-effects.ts; NotificationsService chỉ làm facade/queue decoding |
| Email administration | EmailAdministration: safe retry, batching, deterministic identity, HTML escaping | email-administration-ports.ts, EmailDeliveriesModule |
| Email workers/recovery | DeliverEmailJob, QueueOrderConfirmation, RecoverEmailPublishes, WatchEmailRouting, TrackEmailRouteMatch | email-background.composition.ts; SES/EventBridge/repository adapters |
| SES feedback | RecordEmailFeedback và domain feedbackTransition | Entry point decode SES/SNS; email-feedback-store.ts persist projections |
| Inventory reports | SendInventoryReport: ngày chạy, claim, gửi và cập nhật kết quả | inventory-report.service.ts là composition wrapper |
| Weekly revenue | BuildWeeklyRevenue, DeliverWeeklyRevenue: khoảng ngày, tổng hợp, delivery | DynamoRevenueReader, storefront.reporting.ts và SES adapter |
| Data cleanup | CleanupData: retention, eligibility, backlog | data-cleanup.service.ts bind concrete store |
| Audit queries | AuditQueries: enrichment actor/order | audit-reader.ts; stream diff/conditional audit writer vẫn là technical pipeline |
| Admin operations | AdminOperations: chọn message, dry run, release và ACK sau publish | AwsAdminGateway: SQS/EventBridge commands |
| Uploads | UploadAccess: image scope, avatar prefix, private-report access | S3UploadStorage; UploadsModule |
| Payment review/return | PaymentReviewAdministration; ReadPaymentReturn chỉ đọc và kiểm tra amount | DynamoPaymentReviews, DynamoPaymentSessions; VNPay signature/protocol mapping ở ngoài |

Paths trong bảng bắt đầu từ `apps/api/src/modules/`, trừ các Cognito/Lambda
entrypoints. Những use case commerce đã migrate trong Phase 1–7 tiếp tục được dùng.

## Ví dụ flow profile và chiều import

```text
PATCH /api/profile/me
  -> global authentication + ProfileController: principal.subject, Zod schema
  -> UpdateProfile.execute(subject, patch)
     -> kiểm tra avatar thuộc subject hoặc default prefix
     -> ProfileAvatars.exists(key)
        <- S3ProfileAvatars: HeadObject
     -> ProfileRepository.update(subject, patch)
        <- DynamoProfiles: conditional UpdateItem
     -> ProfileQueries.get(subject)
        -> ProfileRepository.find + ProfileAvatars.publicUrl
  -> response hoặc AppExceptionFilter map application error sang HTTP
```

- Controller import application class để gọi method lúc runtime.
- Application import `type ProfileRepository/ProfileAvatars` hoặc khai báo ports
  tại application; không import S3/Dynamo implementation.
- Infrastructure import `type` của ports và implement contract bằng SDK.
- AuthorizationModule import cả use case lẫn adapter rồi inject chúng qua
  constructor. Interface không tồn tại lúc runtime; object thật được truyền vào
  constructor mới là thứ thực thi method.
- Nếu application dùng một domain function thì import function bình thường.
  `import type` chỉ dùng cho type checking, không thay thế lời gọi function.

## Hành vi và các bảo đảm cần giữ

1. Profile update chỉ sửa record `USER_PROFILE` đã tồn tại; không upsert record
   thiếu hoặc ghi đè một entity khác. Avatar được kiểm tra quyền trước HeadObject.
2. Image upload scope được giới hạn vào product, avatar của chính subject hoặc
   default avatar của admin. Private reports dùng endpoint có quyền admin riêng.
   Global HTTP gate hiện tại vẫn giới hạn generic upload; refactor không tự mở
   endpoint đó cho customer.
3. Tạo sales campaign chờ cả hai Scheduler calls kết thúc trước compensation,
   tránh một schedule tạo xong muộn sau khi đã rollback. Retry version conflict
   dùng application error `CONFLICT`; lỗi hạ tầng thật phải được throw để retry.
4. Email identity, durable claims, lease/CAS, publish-before-marker và trạng thái
   `unknown` được giữ lại. Publish thành công rồi marker thất bại vẫn có thể tạo
   replay; consumer phải deduplicate. Không tuyên bố exactly-once email delivery.
5. SES feedback chỉ cập nhật recipients bị ảnh hưởng; không dùng toàn bộ
   `mail.destination` để đánh dấu bounce/delivery cho một shared message.
6. DLQ chỉ ACK sau publish thành công, release message không được chọn hoặc
   thất bại. SDK ACK/delete fallback ở adapter.
7. Báo cáo tuần đọc hết pages của order scan và item query. Tập trạng thái
   `paid/done/pending` được giữ như trước; đây là định nghĩa hiện tại của report,
   không phải thay đổi sang một chuẩn kế toán mới.
8. Signed VNPay return vẫn chỉ đọc. IPN/reconciliation mới có quyền xác nhận
   trạng thái tiền, phát event hoặc giải phóng tồn kho.

## Architecture gate và test coverage

`scripts/check-architecture.js` dùng TypeScript AST để kiểm tra import, re-export,
type import, require và dynamic import. Đã mở rộng đến common core và nested
feature như `customers/authorization/application`.

`scripts/architecture-inventory.json` phân loại đủ 14 modules. Coverage checker
yêu cầu business module có application layer; HTTP controller và business
job/worker/trigger phải có đường runtime import tới application. Controller không
được import trực tiếp SDK, database, integration, infrastructure hoặc repository.
Module mới chưa được phân loại, exception cũ không còn file và exception không
có lý do sẽ làm check thất bại.

Gate kiểm tra 84 core files và 46 entrypoints. Đây là static dependency/wiring
check, không chứng minh mọi method trong một file đều đúng về mặt nghiệp vụ.
Các test hành vi và kiểm tra code vẫn cần thiết.

Những exception được ghi rõ trong inventory: health/learning không có business
workflow; custom Cognito email/message là provider adapter; audit stream worker
là technical projection; image workflow step chỉ decode S3 metadata.

Verification gồm architecture fixtures, source/test typecheck, regression của
shopping/storefront/payment/audit, compiled Nest HTTP tests và các test mới cho
profile/account lifecycle/sales/email/report/upload/admin operations. DynamoDB
engine tests chạy trên container Local với schema thật, bảng tên ngẫu nhiên và
chỉ cho loopback endpoint; có thêm case conditional profile update.

Kết quả local đã chạy:

| Check | Kết quả |
| --- | --- |
| Architecture | 84 core files, 14 modules, 46 entrypoints; 0 violations |
| Source và test typecheck | Pass |
| Architecture fixtures | 6/6 |
| Shopping | 26/26 |
| Storefront/payment/recovery/reads | 66/66 |
| Audit | 29/29 |
| Compiled HTTP boundaries | 6/6 |
| Remaining application behavior | 22/22 |
| DynamoDB Local engine integration | 5/5 |

Tổng cộng 160 tests pass, không skip. `npm run verify -w @supermarket/api`
chạy 155 tests cùng static checks; `npm run test:integration -w @supermarket/api`
chạy riêng 5 engine tests sau khi cung cấp loopback endpoint. Container test đã
được dừng và bảng tạm được xóa sau test. Đây không phải kết quả GitHub Actions
hay AWS staging.

## Giới hạn còn lại

- Không đổi DynamoDB schema, GSI, infrastructure resources hay API routes.
- `ownedCandidates` còn giới hạn truy vấn cũ tối đa 20 pages; weekly report vẫn
  Scan + Query. Clean Architecture không tự làm query nhanh hơn hoặc rẻ hơn.
- Một số read contracts dùng generic để giữ legacy response/cursor. Core không
  thao tác SDK type nhưng DTO chuẩn hóa sâu hơn có thể làm ở một thay đổi API riêng.
- Conditional persistence, audit projection và durable delivery implementation
  vẫn có state transitions kỹ thuật trong adapter. Không chuyển chúng vào domain
  chỉ để tăng số lượng file thuộc core.
- Chưa chứng minh behavior trên AWS thật: IAM, Cognito federation, Scheduler,
  EventBridge/SQS delivery, S3 và SES cần môi trường integration/staging riêng.
