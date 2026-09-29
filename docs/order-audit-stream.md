# Order audit qua DynamoDB Streams

## Luồng xử lý

```text
Order / Payment Session (cùng DynamoDB table)
  -> DynamoDB Stream (NEW_AND_OLD_IMAGES)
  -> Lambda publisher
       ├─ thành công -> Main FIFO SQS -> Lambda worker -> AUDIT_LOG_ORDER (DynamoDB)
       └─ hết retry -> S3 failure object -> SQS notification/CloudWatch alarm
```

Table là single-table nên Stream bật cho toàn table. Event source mapping chỉ chuyển `ORDER#...` với `SK = ORDER`/`DETAIL` và `PAYMENT#...` với `SK = DETAIL` đến publisher. Publisher chỉ gửi những event thay đổi `status`; event cập nhật field khác không tạo audit. Payment session phải liên kết được với order qua `orderId` hoặc format `orderInfo` cũ. Các event của `ORDER_ITEM#...` và audit record không vào consumer.

Main queue dùng `MessageGroupId` theo order ID để giữ thứ tự các message đã enqueue trong cùng order. `MessageDeduplicationId` lấy từ key của Stream event. Worker dùng conditional `PutItem` theo key audit để retry không tạo bản ghi trùng. Stream của order và payment là hai item riêng: thứ tự enqueue không đảm bảo là thứ tự commit toàn cục giữa hai item.

## Dữ liệu lưu để xem lịch sử

Mỗi lần đổi trạng thái tạo **một record**, với các field phẳng để đọc trực tiếp trong DynamoDB Console:

| Field | Ý nghĩa |
| --- | --- |
| `PK` | `AUDIT_LOG_ORDER#<orderId>`; Query toàn bộ lịch sử của order. |
| `SK` | `EVENT#<occurredAt>#<streamEventId>`; sắp xếp theo thời gian, định danh event để chống ghi trùng. |
| `entityType` | Luôn là `AUDIT_LOG_ORDER`; phân biệt loại item trong single-table. |
| `orderId` | ID order để nhìn thấy ngay trong Console. |
| `changeType` | `ORDER_STATUS` hoặc `PAYMENT_STATUS`; chỉ ra trạng thái của luồng nào. |
| `eventName` | Event gốc từ DynamoDB Stream: `INSERT`, `MODIFY` hoặc `REMOVE`; dùng để debug S3 failure/replay mà không phải suy luận từ `before`/`after`. |
| `before` | Trạng thái trước thay đổi, `null` khi `INSERT`. |
| `after` | Trạng thái sau thay đổi, `null` khi `REMOVE`. |
| `actor` | Map chứa `type`, `id`, `role`; là người hoặc service làm thay đổi item nguồn, không phải Lambda ghi audit. |
| `context` | Map chứa `source`, `reason`, `requestId`, `auditWriter`; gom thông tin ngữ cảnh để Console dễ đọc hơn. |
| `occurredAt` | Thời gian gần đúng của Stream event, dạng ISO 8601 UTC. |
| `sourceSK` | `ORDER` hoặc `DETAIL`; xác định item nguồn khi cùng order có nhiều loại item. |
| `sourceEventId` | Event ID hiển thị trực tiếp để đối chiếu log; cũng nằm trong `SK` để chống ghi trùng. |
| `sourceSequenceNumber` | Đối chiếu với khoảng sequence trong S3 failure object và log Stream; Lambda còn dùng nó để báo lỗi từng record. |
| `paymentTxnRef` | Chỉ có ở event `PAYMENT_STATUS`, để xác định payment session. |

Ví dụ:

```json
{
  "PK": "AUDIT_LOG_ORDER#order-123",
  "SK": "EVENT#2026-09-29T02:20:55.000Z#event-456",
  "entityType": "AUDIT_LOG_ORDER",
  "orderId": "order-123",
  "changeType": "PAYMENT_STATUS",
  "eventName": "MODIFY",
  "before": "pending",
  "after": "success",
  "actor": {
    "type": "SERVICE",
    "id": "lambda:vnpay-ipn",
    "role": "SYSTEM"
  },
  "context": {
    "source": "VNPAY_IPN",
    "reason": "payment_success",
    "requestId": "order-123",
    "auditWriter": "lambda:supermarket-order-audit-stream"
  },
  "occurredAt": "2026-09-29T02:20:55.000Z",
  "sourceSK": "DETAIL",
  "sourceEventId": "event-456",
  "sourceSequenceNumber": "32221500002542073933713924",
  "paymentTxnRef": "txn-789"
}
```

`INSERT` lưu `null -> <initial status>`. `MODIFY` chỉ lưu khi status đổi. `REMOVE` lưu `<last status> -> null`; flow hiện tại không chủ động xóa order nhưng consumer hỗ trợ. Không sao chép toàn bộ order, email khách hàng hay `sourcePK` vì PK nguồn suy ra từ `orderId`/`paymentTxnRef`. `eventName` vẫn được lưu vì đây là field gốc của DynamoDB Stream, giúp đọc lỗi/replay nhanh hơn thay vì phải suy luận từ `before`/`after`. `actor` và `context` lấy từ metadata `audit*` trên item nguồn; nếu item cũ chưa có metadata thì audit dùng `actor.id = unknown` và `context.source = UNKNOWN`. DynamoDB Console không hỗ trợ chèn dòng trống hoặc cố định thứ tự attribute, nên các field theo cụm được lưu dưới dạng map. `orderId`, `occurredAt` và `sourceEventId` lặp một phần key nhưng giữ lại để đọc và đối chiếu log thuận tiện trong Console. Sequence number không tự truy xuất được Stream record nếu thiếu stream ARN, shard ID hoặc event gốc đã hết hạn; S3 failure object giữ các thông tin đó cùng payload cho event lỗi.

Để xem lịch sử, Query table với `PK = AUDIT_LOG_ORDER#<orderId>` và `SK begins_with EVENT#`. Audit phản ánh trạng thái đã ghi ở order/payment session. Hiện job hết hạn order chưa chuyển payment session từ `pending` sang `expired`, nên audit payment cũng không tự sinh chuyển trạng thái này.

## Retry, DLQ và retention

- Publisher gửi Main FIFO thất bại: trả Stream sequence number cho Lambda event source mapping retry. Sau 5 lần không thành công, Lambda lưu full invocation batch cùng metadata (`streamArn`, `shardId`, sequence range, failure condition) vào S3. Bucket private, dùng SSE-S3, giữ object 90 ngày và được retain khi xóa stack. EventBridge chỉ gửi thông báo `Object Created` cho key `aws/lambda/` vào `supermarket-order-audit-stream-dlq` để CloudWatch alarm báo; queue này là **notification**, không chứa full Stream event. Dùng EventBridge để tránh `s3:TestEvent` của S3 direct notification gây báo động giả.
- Worker ghi DynamoDB thất bại: message xuất hiện lại sau visibility timeout. Sau 5 lần nhận không thành công, message gốc vào `supermarket-order-audit-worker-dlq.fifo`. Worker trả lỗi theo từng SQS message và dừng xử lý các message sau lỗi trong batch FIFO.
- Main FIFO, Worker DLQ và Stream notification queue giữ message tối đa 14 ngày. DynamoDB Stream chỉ giữ event gốc tối đa 24 giờ; S3 payload phục vụ replay sau khoảng này, trong thời hạn 90 ngày. Audit record trong table là lịch sử trạng thái dài hạn.
- CloudWatch alarm theo dõi hai queue lỗi, tuổi message trong Main queue, `IteratorAge` của Stream và `DestinationDeliveryFailures` khi Lambda không chuyển được batch lỗi vào S3. Queue cũ `supermarket-audit-log` không nằm trong luồng này.

Stream chỉ bắt các thay đổi sau lúc bật; không backfill order cũ. Những audit record đã ghi theo schema cũ vẫn còn nguyên. Worker chấp nhận message schema cũ đang nằm trong queue và chuyển thành schema phẳng trước khi ghi; thay đổi code không tự cập nhật record cũ trong DynamoDB. Không deploy trong lần chỉnh sửa local này.

## Thử Worker DLQ và redrive

`scripts/test-order-audit-dlq.ps1` mặc định chỉ đọc số message trong ba queue. Cờ `-InjectWorkerFailure -ExpectedAccountId <account>` gửi body sai định dạng vào Main FIFO để quan sát retry và Worker DLQ. Body sai là lỗi vĩnh viễn; redrive nguyên message vẫn lỗi.

`scripts/test-order-audit-redrive.ps1 -OrderId <id> -ExpectedAccountId <account>` kiểm tra account, queue và một audit record có sẵn; mặc định không gửi message. Thêm `-Execute` để sao chép record đó vào Worker DLQ và chạy AWS managed redrive về Main FIFO. Script đọc được cả audit record cũ và schema phẳng. Worker coi bản sao là duplicate đã ghi, nên không tạo thêm audit record nếu bản gốc vẫn tồn tại. Script từ chối chạy khi Worker DLQ không rỗng: managed redrive chuyển mọi message trong DLQ, không chọn riêng một message. Không chạy hai phép thử đồng thời; xem `ListMessageMoveTasks` và CloudWatch logs sau khi redrive.

## Replay Stream failure từ S3

S3 không có managed redrive về Lambda. Sau khi xử lý nguyên nhân lỗi, dùng `scripts/replay-order-audit-s3-failure.ps1 -S3Key <key> -ExpectedAccountId <account>`. Script chỉ chấp nhận key `aws/lambda/` và mặc định đọc object, kiểm tra account, table, stream ARN, sequence range, payload. Thêm `-Execute` để invoke publisher đồng bộ bằng full Stream payload trong object. Publisher gửi lại vào Main FIFO; worker ghi audit theo key cố định. Script không xóa object S3, không đổi trạng thái order/payment, và kiểm tra `batchItemFailures` trong response. Nếu còn failure, sửa lỗi rồi chạy lại cùng object. Một batch có thể chứa cả event đã xử lý; conditional PutItem giúp replay không tạo audit trùng.

Ví dụ chạy trong PowerShell, mỗi lệnh nằm trên một dòng:

```powershell
.\scripts\replay-order-audit-s3-failure.ps1 -S3Key 'aws/lambda/<mapping-id>/<shard-id>/<date>/<file>' -ExpectedAccountId '<account-id>'
.\scripts\replay-order-audit-s3-failure.ps1 -S3Key 'aws/lambda/<mapping-id>/<shard-id>/<date>/<file>' -ExpectedAccountId '<account-id>' -Execute
```

Object lỗi trong S3 có `requestContext`, `DDBStreamBatchInfo` và `payload` (JSON string của invocation gốc). `DDBStreamBatchInfo` chứa `streamArn`, `shardId`, `startSequenceNumber` và `endSequenceNumber`; `payload.Records` chứa từng event với `eventID`, `dynamodb.SequenceNumber`, `Keys`, `OldImage`, `NewImage`. Script cần IAM `s3:GetObject`, `cloudformation:DescribeStacks`, `sts:GetCallerIdentity` và `lambda:InvokeFunction` khi chạy `-Execute`.

Có thể lấy `S3Key` từ `detail.object.key` của EventBridge message trong Stream queue hoặc liệt kê object dưới prefix `aws/lambda/` của bucket `OrderAuditStreamFailureBucketName`. Chạy replay script **không có `-Execute`** để xem `condition`, `functionError`, Lambda request ID, từng event ID, source PK/SK, sequence và status trước/sau. S3 object cho biết batch nào thất bại; exception chi tiết nằm trong CloudWatch Logs của `/aws/lambda/supermarket-order-audit-stream` quanh thời điểm đó. S3 payload chứa toàn bộ `NEW_AND_OLD_IMAGES`, có thể có thông tin khách hàng: hạn chế IAM đọc bucket và không in payload ra log. Không bật tự động replay ngay khi object được tạo, vì lỗi dữ liệu/code chưa sửa sẽ lặp lại.

```powershell
$bucketName = '<OrderAuditStreamFailureBucketName trong CloudFormation Outputs>'
aws s3api list-objects-v2 --bucket $bucketName --prefix 'aws/lambda/' --query 'Contents[].Key' --output text --region ap-southeast-1 --profile nhandev
```

Nếu queue `supermarket-order-audit-stream-dlq` đã có message từ trước khi chuyển sang EventBridge, message dạng `s3:TestEvent` là kiểm tra cấu hình S3, **không phải lỗi publisher**. Message cũ dạng `DDBStreamBatchInfo` chỉ chứa Stream batch metadata và không có S3 object tương ứng; khi đó phải đọc lại event từ DynamoDB Stream trước hạn 24 giờ nếu còn. Sau khi xác minh đúng là `s3:TestEvent`, có thể xóa riêng message đó trong SQS Console để alarm theo độ sâu queue trở về bình thường.

### Test lỗi thật, tách khỏi order production

`OrderAuditFailureTestStack` là stack độc lập, chỉ được tạo khi CDK có context `orderAuditFailureTest=true`. Nó có table Stream, main FIFO, worker và S3 bucket riêng. Publisher gắn với Stream cố ý gửi đến **SQS URL không tồn tại**; AWS SDK trả lỗi `SendMessage`, Lambda event source mapping retry hai lần rồi AWS `OnFailure` ghi invocation thật vào S3. Replay dùng một publisher thứ hai của test stack trỏ đến main FIFO thật. Worker ghi audit vào **test table**. Không đổi cấu hình hoặc dữ liệu của order production. Bucket test giữ failure object 7 ngày; khi xóa test stack, table/bucket test bị xóa.

Sau khi build Lambda ZIP, deploy riêng test stack bằng CDK với profile/account đã kiểm tra:

```powershell
npm run build:lambda
npx cdk deploy OrderAuditFailureTestStack --app "npx ts-node --project infra/tsconfig.json infra/bin/aws-api.ts" -c orderAuditFailureTest=true --profile nhandev --require-approval never
```

Chạy test script từ repo root. Lệnh đầu chỉ kiểm tra account/stack; lệnh sau ghi **một** test order vào table riêng và chờ S3 object do AWS tạo:

```powershell
.\scripts\test-order-audit-real-failure.ps1 -ExpectedAccountId '<account-id>'
.\scripts\test-order-audit-real-failure.ps1 -ExpectedAccountId '<account-id>' -Execute
```

Script in ra `OrderId`, `S3Key` dưới `aws/lambda/`, condition/sequence, và lệnh replay. CloudWatch Logs của failing publisher cho thấy lỗi SQS thật. Nếu S3 object chưa tới trước timeout, chạy lại script **không có `-Execute`** với `-OrderId` đã in để tìm tiếp, tránh tạo event thứ hai. Dùng lệnh replay được in ra ở chế độ đọc, sau đó thêm `-Execute -VerifyAudit`. `-VerifyAudit` đợi worker ghi audit record vào test table và kiểm tra đúng source event/status. Script PowerShell chạy trên máy local nhưng gọi AWS thật.

Object cũ dưới `manual-test/order-audit/` được tạo bởi script giả lập trước đây không phải kết quả `OnFailure`; không dùng nó để đánh giá test lỗi thật. Chỉ object dưới `aws/lambda/` do Lambda event source mapping tạo mới chứng minh nhánh Stream failure hoạt động.
