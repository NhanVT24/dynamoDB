# Order audit qua DynamoDB Streams

`MarketplaceProductsDev` là single-table, nên Stream được bật cho toàn bộ table
với `NEW_AND_OLD_IMAGES`. Lambda event source mapping chỉ chuyển record có
`PK` bắt đầu bằng `ORDER#` và `SK` bằng `ORDER` hoặc `DETAIL` đến consumer.
`ORDER_ITEM#...` và audit record không đi vào consumer.

Lambda đọc Stream tạo nội dung audit tối thiểu, gửi vào FIFO queue
`supermarket-order-audit-main.fifo`. `MessageGroupId` theo order ID để giữ thứ tự
trong từng order; `MessageDeduplicationId` theo Stream event ID. Lambda worker
đọc queue và ghi audit vào cùng table theo schema:

- `PK = AUDIT_LOG_ORDER#<orderId>`
- `SK = EVENT#<thời gian Stream event>#<eventID>`
- `entityType = AUDIT_LOG_ORDER`, `eventName`, `previousStatus`, `status`,
  `occurredAt`, `sourceSK`, `sourceEventId`, `sourceSequenceNumber`

`INSERT` ghi trạng thái ban đầu. `MODIFY` chỉ ghi khi `status` thay đổi;
các cập nhật khác như thêm payment reference được bỏ qua. `REMOVE` ghi trạng
thái cuối trước khi xóa. Hiện luồng order không chủ động xóa order, nhưng
consumer đã hỗ trợ sự kiện này. Audit không sao chép email hoặc toàn bộ order.

Key audit được tạo từ identity của Stream event, và `PutItem` có condition
chống ghi trùng khi Lambda hoặc SQS retry. Hai chỗ xử lý lỗi độc lập:

- Nếu publisher không gửi được vào main queue, nó trả failed Stream sequence
  number để Lambda event source mapping retry. Hết 5 lần retry, metadata batch
  lỗi vào `supermarket-order-audit-stream-dlq`. Queue này không giữ full Stream
  event; phải xử lý trước khi event gốc hết hạn 24 giờ.
- Nếu audit worker không ghi được vào DynamoDB, message ở main queue hiện lại
  sau visibility timeout và AWS retry. Sau 5 lần nhận không thành công, message
  gốc vào `supermarket-order-audit-worker-dlq.fifo`. Worker nhận mỗi lần một
  message để một lỗi không đẩy những message chưa xử lý vào DLQ cùng nó.

Main queue và worker DLQ giữ message tối đa 14 ngày. Stream DLQ giữ metadata
tối đa 14 ngày; thời gian đó không kéo dài tuổi thọ event gốc trong Stream.
Hai DLQ đều có CloudWatch alarm gửi đến admin alert SNS topic. Alarm cũng theo
dõi tuổi message trong main queue, độ trễ Stream (`IteratorAge`) và lỗi gửi
event vào Stream DLQ (`DestinationDeliveryFailures`). Khi có message trong
Stream DLQ, cần lấy event gốc và xử lý trước khi Stream hết hạn 24 giờ.
Queue cũ `supermarket-audit-log` không nằm trong luồng order audit này.

Stream chỉ bắt các thay đổi từ sau khi Stream được bật; mapping đọc từ đầu
Stream để không bỏ sót thay đổi xảy ra trong lúc deploy. Không backfill order cũ.
DynamoDB Streams lưu sự kiện tối đa 24 giờ. Với audit có
yêu cầu lưu lâu hơn, các audit record trong table là dữ liệu lưu trữ chính.

Để xem lịch sử một order, Query table bằng `PK = AUDIT_LOG_ORDER#<orderId>`
và `SK begins_with EVENT#`.
