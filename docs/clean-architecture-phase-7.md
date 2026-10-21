# Phase 7 — HTTP boundaries, architecture checks, integration và release readiness

## 1. Trạng thái và phạm vi

Đã triển khai code/guardrails và kiểm chứng tại local. CI workflow được viết trong
repository, chưa có bằng chứng một run trên GitHub. Không deploy, gọi VNPay thật,
ghi dữ liệu AWS hoặc thay table/index/Construct IDs trong phase này.

Phạm vi controller được chuẩn hóa: ShoppingController, StorefrontController,
ProductsPublicController và auth của PaymentRecoveryController. Các module khác
còn sử dụng controller/service truyền thống; không tuyên bố toàn backend đã
chuyển sang Clean Architecture.

## 2. Controller và auth boundary đã thay đổi gì

### Request-scoped principal

Thêm `apps/api/src/common/auth/request-principal.ts`:

- `getRequestPrincipal(request)` gọi verifier hiện có rồi cache Promise trên
  WeakMap theo object request. Cả pending Promise và kết quả null đều được giữ
  trong cùng request; các request khác không dùng chung principal.
- `requireRequestPrincipal(request, { roles, permission, message })` kiểm tra
  signed-in/role/permission và ném HTTP 403 với message hiện có.
- Global preHandler, AuditMutationInterceptor và các controllers đã chuyển dùng
  cùng helper. Không thêm guard mới chồng lên route policy hiện có, không thay
  cơ chế JWT verification hoặc account-status rules.
- Đây là cache trong một request, không phải cache token giữa nhiều request;
  không ghi principal lên một field request mà caller có thể tự giả mạo.
- Worker không bị buộc có FastifyRequest. Actor/service attribution của worker
  tiếp tục theo audit context hiện tại.

Luồng HTTP mutation:

```text
Fastify preHandler -> getRequestPrincipal(request)
  -> AuditMutationInterceptor -> cùng Promise/principal -> audit context
  -> Controller -> requireRequestPrincipal -> cùng principal
  -> validate input
  -> service facade chuyển principal thành actor/email nghiệp vụ
  -> use case kiểm tra ownership/version/state
  -> output port -> concrete adapter -> database/provider
```

Role/permission ở controller không thay thế ownership trong application. Actor
không lấy từ ownerSub/body của caller. Helper chỉ chạy ở outer boundary; domain
và application không import Nest/Fastify/Cognito.

### Validation và types

- Cả `/api/products` và `/api/storefront/products` parse cùng query schema ở
  controller. `StorefrontService.listProducts` nhận CatalogQuery đã parse;
  service không còn import Zod query schema.
- Shopping controller tiếp tục parse body/query/params như trước. Các query
  facade được đổi từ `Record<string, any>` sang types suy ra từ Zod schemas.
- Schema validate input lúc runtime; TypeScript chỉ kiểm tra code lúc compile.
  Các use case vẫn giữ business invariants riêng cho internal/worker callers.
- Giữ endpoint URL, method và success status. Có một thay đổi quyền có chủ ý:
  raw management reads `/api/shopping-items`, `/all`, `/page-cursor`, `/:id` nay
  yêu cầu admin; trước đó chúng có thể trả record nội bộ cho public. Storefront
  dùng `/api/products` và màn hình admin hiện có authenticatedFetch. `/mine` vẫn
  dành cho signed-in owner; `/meta` và demo chỉ cung cấp metadata/mock công khai.
  Client bên ngoài từng đọc raw routes không token phải chuyển sang public API.

### Contracts cần giữ

| API/nhóm API | Quyền | Boundary và kết quả |
| --- | --- | --- |
| GET hai product aliases | Public | Query/id sai -> 400; product không hiển thị -> 404 |
| POST shopping-items | products:create; admin được phép | Body hợp lệ -> 201; identity lấy từ principal |
| PATCH product/increment | products:update-own; admin được phép | Application kiểm tra owner/version; conflict -> 409 |
| DELETE product | products:delete-own; admin được phép | Application + conditional delete/audit; thành công -> 204 |
| GET shopping-items/mine | Signed in | Dùng subject của principal |
| GET shopping-items, /all, /page-cursor, /:id | admin | Raw management records không còn public; user thường dùng /mine |
| POST storefront/orders | customer hoặc admin | Body hợp lệ -> 202; tổng tiền do server tính |
| GET order status/details/me | Signed in | Application/reader giới hạn owner; foreign detail -> 404 |
| POST cancel/refund/refund-status | customer hoặc admin | Application vẫn kiểm tra owner/state/refund identity |
| GET/POST payment reviews | admin | Không tự chuyển tiền hoặc sửa stock khi resolve review |

## 3. Cleanup và logging

- Loại các auth checks và request logs lặp trong shopping/storefront controllers.
- Xóa `common/auth/cognito-groups.ts` sau khi rà toàn repository không còn caller.
  Global admin gate nay dùng principal helper. Không xóa facade/repository còn
  được queue handlers, scripts hoặc integrations sử dụng.
- AppExceptionFilter giữ error -> HTTP mapping, nhưng bỏ logging raw exception,
  stack/message, request body, query và raw URL; bỏ console.error trùng lặp.
  Provider errors có thể chứa signed URLs nên không ghi nguyên error object.
- Request/response logs dùng route template, method, correlationId và statusCode.
  Response log có `durationMs`. Correlation header chỉ nhận 1–128 ký tự
  alphanumeric/`.`/`_`/`:`/`-`; giá trị khác được thay bằng UUID server tạo.
- Expected HTTP/business errors ghi warn; unexpected errors ghi error với
  context an toàn. Chi tiết lỗi nghiệp vụ cần được tìm qua service logs với
  operation/resource identity phù hợp, không bật lại raw-body logging để debug.

Giới hạn: đây là cleanup HTTP boundary; không phải audit toàn bộ log ở mọi module
hoặc thay đổi API Gateway/CloudWatch access-log configuration đang deploy.

## 4. Dependency checks tự động

Thêm `apps/api/scripts/check-architecture.js`, phân tích TypeScript AST và resolve
module theo tsconfig, không dùng regex để tìm import trong comment/string.

```text
Domain       -> chỉ domain
Application  -> application hoặc domain
Outer layers -> được import core và concrete integration theo trách nhiệm
```

Core không được import Nest, AWS SDK, config, database, controller, service facade
hoặc repository ở ngoài core. Rule bao gồm import type, import type query,
re-export, require và dynamic import. Computed import bị từ chối. Core import
qua outer barrel cũng bị từ chối; core barrel có dependency sai bị check riêng.

Script kiểm tra 46 files application/domain hiện tại, không có exception allowlist.
Đây là kiểm tra module dependencies, không tự chứng minh mọi business rule đặt
đúng nơi hoặc phát hiện mọi cách dùng eval/indirection có chủ ý để né rule.
Outer/legacy modules nằm ngoài enforcement scope này.

Có 3 tests cho chính checker: allowed dependency/comment, erased/external/barrel
dependencies và domain -> application, require/dynamic/computed imports.

## 5. CI và các lệnh kiểm chứng

Thêm `.github/workflows/backend-verify.yml`: PR, push khi API hoặc
dependency manifests thay đổi, và workflow_dispatch. Quyền contents:read; không
có AWS credentials/OIDC/deploy job. Workflow dùng Node 24, npm ci, fake test
configuration và Docker DynamoDB Local được ghim image digest.

Chạy ở `apps/api`:

```powershell
npm run verify
```

Verify chạy tuần tự để các build không xóa dist trong khi suite khác đang đọc:

```text
check:architecture
test:architecture
typecheck
typecheck:tests
test:shopping
test:storefront
test:audit
test:boundaries
```

`tsconfig.tests.json` bổ sung typecheck cho source + toàn bộ TS test files.
`typecheck:tests` build trước khi kiểm tra các tests import compiled HTTP modules,
để chạy đúng trên checkout CI sạch chưa có dist. Một
test audit cũ có kết quả Observable<unknown> được thêm runtime narrowing trước
khi assert các fields, không bỏ test hoặc nới compiler để che lỗi.

## 6. Integration bằng DynamoDB engine thật

Đã chạy Docker DynamoDB Local **3.3.2**, không dùng middleware fake cho suite này.
Container chỉ expose `127.0.0.1:18000`, in-memory/sharedDb, image:

```text
amazon/dynamodb-local@sha256:6ada631ec7aa5fc83446855eb17233e3dad184fec47477e8140c6c569cfe0c86
```

Tái hiện tại PowerShell:

```powershell
docker run --detach --rm --name supermarket-phase7-dynamodb --publish 127.0.0.1:18000:8000 amazon/dynamodb-local@sha256:6ada631ec7aa5fc83446855eb17233e3dad184fec47477e8140c6c569cfe0c86 -jar DynamoDBLocal.jar -inMemory -sharedDb
$env:PHASE7_DYNAMODB_ENDPOINT = 'http://127.0.0.1:18000'
npm run test:integration
docker stop supermarket-phase7-dynamodb
```

Suite bắt buộc endpoint HTTP loopback có port rõ ràng, từ chối AWS/non-loopback.
Ghi đè table name thành `Phase7_<random id>`, credentials local và dummy VNPay
configuration trước khi import application; không dùng merchant/provider thật.
Có readiness polling. Table tạo riêng, cleanup trong after hook; CI luôn dừng
container cả khi suite thất bại. Process bị kill đột ngột có thể chưa chạy after;
container in-memory bị xóa khi stop sẽ loại bỏ dữ liệu test còn lại.

Định nghĩa table từ `db:init` được chuyển nguyên sang
`database/dynamodb/table-definition.ts` để script và integration dùng chung.
Integration tạo đủ các indexes, gồm multiattribute StatusTimelineIndex và
SearchNameIndex, không dùng schema tối giản để né validation.
CDK infrastructure không thay đổi; chưa kiểm chứng deployed schema khớp local.

Bốn scenarios đã qua:

1. Hai product updates cạnh tranh cùng version: chỉ một thắng; write adapter
   từ chối owner sai mà không tăng version.
2. Hai checkout cạnh tranh stock: một thành công, không oversell; replay không
   trừ stock lần hai; cancel lặp chỉ release một lần. Read detail giữ price và
   ownership.
3. Legacy completion ghi status/audit cùng transaction; replay không thêm audit;
   transition bị từ chối không để lại status audit.
4. Recovery đi qua GSI page bị filter thành rỗng, checkpoint tiến tới pending
   payment; attempt claim cũ bị DynamoDB conditional write từ chối.

Các suites trước tiếp tục kiểm tra timeout/ambiguous response/provider signature
và worker orchestration bằng fake transport. Local engine không mô phỏng đầy đủ
AWS IAM, throttling, eventual-consistency timing, Streams/SQS/EventBridge hoặc
VNPay network; chưa có staging/provider proof cho các phần này.

## 7. Kết quả kiểm chứng

| Kiểm tra | Kết quả local |
| --- | --- |
| Architecture scanner | 46 core files, 0 violations |
| Architecture checker tests | 3 passed |
| Shopping regression | 26 passed |
| Storefront/payment/recovery/read regression | 66 passed |
| Audit regression | 29 passed |
| HTTP/auth/logging boundary | 5 passed |
| DynamoDB Local engine integration | 4 passed |
| Source + TS test typechecks | Passed |

Tổng các suites trên: **133 tests**. Boundary tests có cả compiled controllers và
full createNestApp: preHandler -> audit interceptor -> controller giữ đúng actor,
validate query aliases, chặn role/permission không hợp lệ và chuẩn hóa correlation
header. Raw management reads được kiểm tra cả anonymous/customer bị chặn trước
service lẫn admin được phép. Các controller tests dùng mocked use case khi chỉ kiểm tra HTTP boundary;
không gọi provider thật.

## 8. Runbook trước release, quan sát và rollback

Các bước sau đã được chuẩn bị, **chưa thực thi trên AWS/staging**:

1. Lưu artifact/version/config đang chạy trước release. Build bằng workflow release
   hiện có; chạy verify và integration trên đúng revision dự định deploy. Workflow
   mới chỉ verify, không tự publish hay deploy.
2. Trên staging, đối chiếu IAM và table/index schema, runtime env (đặc biệt
   AUTH_ALLOW_UNVERIFIED_JWT phải false), queue/DLQ routes và provider config.
   Test đúng JWT Cognito, public product, delegated permission, foreign order,
   checkout -> IPN -> worker, cancel/expiry/refund và manual review.
3. Với VNPay sandbox, đối chiếu amount, txnRef, merchant/signature và trạng thái
   provider. Browser return không thay thế IPN/provider verification. Không dùng
   local dummy credentials hoặc tự gửi lại refund khi kết quả chưa rõ.
4. Theo dõi error rate/latency theo route; Lambda Errors/Throttles/Duration,
   SQS ApproximateAgeOfOldestMessage và DLQ visible count. Theo dõi các event
   payment.recovery_item_failed, payment.manual_review_required,
   checkout.provisioning_interrupted, payment.review_store_failed cùng open cases.
   Tạo/đối chiếu alarms qua hạ tầng hiện có sau khi chọn ngưỡng dựa trên baseline;
   phase này không tự triển khai CloudWatch alarms mới.
5. Chỉ mở rộng release khi smoke tests đúng contract và error/backlog không tăng
   bất thường so với baseline. Không có latency SLA mới chỉ từ kết quả local.
6. Rollback code bằng artifact/config đã lưu của phiên bản tương thích trước đó.
   Phase 7 không đổi storage layout nên không có reverse schema migration riêng.
   Rollback code không hoàn tác giao dịch đã commit, email đã gửi hoặc provider
   settlement. Đối chiếu order/payment/refund với provider, không restore stock
   hoặc reset cursor/refund identity thủ công để che lỗi.
7. Nếu version lỗi tiếp tục gây side effect, kiểm soát producer/consumer/job liên
   quan theo runbook vận hành; giữ durable messages/cases và xử lý backlog sau khi
   sửa. Không blind replay DLQ hoặc request refund mới cho kết quả ambiguous.

Ví dụ Logs Insights cho response logs mới (nếu JSON fields được ingest):

```text
fields @timestamp, route, statusCode, durationMs, correlationId
| filter msg = "api response sent"
| stats count(*) as requests, pct(durationMs, 95) as p95Ms by route, statusCode, bin(5m)
```

## 9. Những hạng mục vẫn cần làm riêng

- Order/customer queries và notification scan, owned-products giới hạn 20 pages,
  product sort trong memory: cần access-pattern/index/pagination work và đo cost.
- Delivery/idempotency của mọi notification/email chưa được chuẩn hóa toàn bộ;
  không có exactly-once guarantee cho toàn hệ thống.
- Legacy `done` theo notification sent vẫn là rule cũ, không phải proof giao hàng.
- Sales/auth/upload/email modules chưa được migrate toàn bộ. Không tạo lớp rỗng
  chỉ để có đủ bốn folder.
- CI run trên GitHub, authenticated Cognito/VNPay staging proof, alarm rollout và
  production deployment vẫn chưa có. Hoàn thành local hardening không thay thế
  các release gates này.
