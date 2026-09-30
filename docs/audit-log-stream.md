# Audit log qua DynamoDB Streams

Flow hiện tại dùng audit log chung cho `ORDER`, `PAYMENT` và `USER`.

```text
Source table item change
DynamoDB Stream
EventBridge Pipe (lọc key, chuyển Stream record)
AuditLog FIFO SQS
AuditLogWorker Lambda (diff OldImage/NewImage, ghi audit)
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
    "auditWriter": "lambda:supermarket-audit-log-worker"
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

- Pipe đọc DynamoDB Stream và gửi nguyên Stream record vào FIFO SQS. Pipe retry khi chuyển tiếp lỗi; record không xử lý được được đưa vào `supermarket-audit-log-pipe-dlq`.
- Worker diff `OldImage`/`NewImage` theo whitelist; nếu không có field cần audit thay đổi thì bỏ qua. Nếu ghi table `supermarket-audit-log` lỗi, SQS sẽ retry theo visibility timeout. Sau `maxReceiveCount`, message vào worker DLQ.
- Worker dùng conditional write `attribute_not_exists(PK) AND attribute_not_exists(SK)` để replay không tạo duplicate.

## Replay

- Worker DLQ có thể replay về `AuditLogMainQueue` nếu payload hợp lệ và lỗi gốc đã được sửa. Trong giai đoạn chuyển tiếp, worker cũng nhận audit record `AUDIT_LOG` cũ đã được publisher đưa vào queue.
- Pipe DLQ lưu các Stream record chưa chuyển được. Kiểm tra lỗi gốc trước khi replay vào queue chính.

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

## CDK stacks

- `SupermarketAwsStack` owns the source table, audit table, audit FIFO queue, worker and worker alarms.
- `SupermarketAuditLogStreamStack` owns the EventBridge Pipe, Pipe DLQ and Pipe alarms. It imports the source Stream ARN and audit queue from the API stack.
- `SupermarketAwsStack` owns the admin SNS topic and an EventBridge rule that routes Pipe alarm state changes to that topic.

Deploy toàn bộ bằng một lệnh tại thư mục gốc repo (PowerShell):

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile nhandev -DomainName truyenmasinhvien.com
```

Lệnh này deploy API stack trước, rồi Stream stack, sau đó frontend và S3. Dấu `--` chuyển `-AwsProfile` và `-DomainName` từ npm sang script PowerShell.

For an existing deployment, update the API stack first, then the Stream stack. The API stack temporarily keeps the audit queue URL export because the deployed publisher imports it. Pipe starts at `TRIM_HORIZON`; during migration, the old publisher and the new Pipe may temporarily enqueue the same Stream event. Conditional audit writes prevent duplicate stored records. Inspect the old retained S3 failure bucket before retiring its replay process. Editing CDK source does not move live resources.

