# Audit log qua DynamoDB Streams

Flow hiện tại dùng audit log chung cho `ORDER`, `PAYMENT` và `USER`.

```text
Source table item change
DynamoDB Stream
AuditLogStream Lambda
AuditLog FIFO SQS
AuditLogWorker Lambda
supermarket-audit-log DynamoDB table
```

## Source được audit hiện tại

| Entity | Stream key được nhận | Field đang lưu | Lý do |
| --- | --- | --- | --- |
| `ORDER` | `PK = ORDER#...`, `SK = ORDER` hoặc `DETAIL` | `status` | Theo dõi vòng đời đơn hàng. |
| `PAYMENT` | `PK = PAYMENT#...`, `SK = DETAIL` | `status` | Theo dõi vòng đời thanh toán gắn với order. |
| `USER` profile | `PK = USER#...`, `SK = PROFILE` | `displayName`, `avatarKey`, `status` | Theo dõi thay đổi profile; không ghi email/password. |
| `USER` authorization | `PK = USER#...`, `SK = AUTHORIZATION` | `permissions` | Theo dõi thay đổi String Set permission. |

Các field nhạy cảm như password, token, email, phone, address, raw gateway payload không đưa vào audit log. Whitelist chi tiết nằm ở `docs/audit-log-whitelist.md` và `apps/api/src/modules/audit-log/audit-log.ts`.

## Record ghi xuống table `supermarket-audit-log`

Key chính:

- `PK = AUDIT_LOG#<resourceType>#<resourceId>`
- `SK = EVENT#<occurredAt>#<streamEventId>`

Các attribute chính:

- `entityType = AUDIT_LOG`
- `resourceType`, `resourceId`
- `parentResourceType`, `parentResourceId` nếu event payment thuộc một order
- `action`: `CREATED`, `UPDATED`, `DELETED`
- `eventName`: `INSERT`, `MODIFY`, `REMOVE`
- `changes`: map `{ field: { before, after } }`
- `actor`
- `context`
- `occurredAt`
- `source`: DynamoDB Stream metadata tối thiểu gồm `pk`, `sk`, `eventId`, `sequenceNumber`

Ví dụ:

```json
{
  "PK": "AUDIT_LOG#ORDER#order-123",
  "SK": "EVENT#2026-09-29T02:20:55.000Z#90800b5cfd20407b06bb312eed9b77ac",
  "entityType": "AUDIT_LOG",
  "resourceType": "ORDER",
  "resourceId": "order-123",
  "action": "UPDATED",
  "eventName": "MODIFY",
  "changes": {
    "status": { "before": "awaiting_payment", "after": "paid" }
  },
  "actor": { "type": "SERVICE", "id": "lambda:vnpay-ipn", "role": "SYSTEM" },
  "context": {
    "source": "VNPAY_IPN",
    "reason": "payment_success",
    "requestId": "order-123",
    "auditWriter": "lambda:supermarket-audit-log-stream"
  },
  "occurredAt": "2026-09-29T02:20:55.000Z",
  "source": {
    "type": "DYNAMODB_STREAM",
    "pk": "ORDER#order-123",
    "sk": "ORDER",
    "eventId": "90800b5cfd20407b06bb312eed9b77ac",
    "sequenceNumber": "32221500002542073933713924"
  }
}
```

## Failure handling

- Nếu publisher Lambda không gửi được message vào FIFO SQS, Lambda event source mapping retry theo Stream sequence. Sau khi hết retry, payload invocation được ghi vào S3 failure bucket.
- Nếu worker Lambda đọc message từ SQS nhưng ghi table `supermarket-audit-log` lỗi, SQS sẽ retry theo visibility timeout. Sau `maxReceiveCount`, message vào worker DLQ.
- Worker dùng conditional write `attribute_not_exists(PK) AND attribute_not_exists(SK)` để replay không tạo duplicate.

## Replay

- Worker DLQ có thể replay về `AuditLogMainQueue` nếu payload hợp lệ và lỗi gốc đã được sửa. Worker chỉ nhận format `AUDIT_LOG` hiện tại; message `AUDIT_LOG_ORDER` cũ cần được xử lý riêng trước khi replay.
- S3 failure object không có managed redrive tự động như SQS. Cần đọc object, kiểm tra payload, sửa lỗi gốc, rồi invoke lại publisher bằng payload đó.
- Không auto replay object S3 ngay khi được tạo, vì nếu lỗi do data/code chưa sửa thì sẽ lặp lại failure.

## Test lỗi bằng browser

Script browser hiện tại:

```text
scripts/browser-audit-log-worker-failure.js
```

Endpoint test:

```text
POST /api/admin/ops/audit-log/worker-failure-test
GET  /api/admin/ops/dlq?queue=auditLogWorker&maxMessages=10
```

Script này gửi một payload cố tình sai vào `AuditLogMainQueue`. Worker sẽ reject, SQS retry, rồi message đi vào `AuditLogWorkerDlq`.

## Test stack độc lập

Stack test lỗi thật đã đổi sang:

```text
AuditLogFailureTestStack
```

Deploy riêng khi cần kiểm thử nhánh S3 failure:

```powershell
npx cdk deploy AuditLogFailureTestStack --app "npx ts-node --project infra/tsconfig.json infra/bin/aws-api.ts" -c auditLogFailureTest=true --profile nhandev --require-approval never
```

## CDK stacks

- `SupermarketAwsStack` owns the source table, audit table, audit FIFO queue, worker and worker alarms.
- `SupermarketAuditLogStreamStack` owns the Stream publisher, event source mapping, failure bucket, failure queues and publisher alarms. It imports only the source Stream ARN and audit queue from the API stack.
- `SupermarketAwsStack` owns the admin SNS topic and an EventBridge rule that routes Stream alarm state changes to that topic. The Stream stack does not create or import the topic.

Deploy toàn bộ bằng một lệnh tại thư mục gốc repo (PowerShell):

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile nhandev -DomainName truyenmasinhvien.com
```

Lệnh này deploy API stack trước, rồi Stream stack, sau đó frontend và S3. Dấu `--` chuyển `-AwsProfile` và `-DomainName` từ npm sang script PowerShell.

For an existing deployment, update the API stack before creating the Stream stack to release the old publisher's fixed Lambda and queue names. Complete the migration within the Stream's 24-hour retention window. The new mapping starts at `TRIM_HORIZON`; audit writes are idempotent. The old failure bucket has `RETAIN`, so inspect or migrate any objects it already contains. Editing CDK source does not move live resources.

Stack này độc lập với dữ liệu thật. Publisher cố ý gửi đến SQS URL không tồn tại để tạo failure object thật trong S3.

