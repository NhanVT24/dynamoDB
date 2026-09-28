# Order audit qua DynamoDB Streams

`MarketplaceProductsDev` là single-table, nên Stream được bật cho toàn bộ table
với `NEW_AND_OLD_IMAGES`. Lambda event source mapping chỉ chuyển record có
`PK` bắt đầu bằng `ORDER#` và `SK` bằng `ORDER` hoặc `DETAIL` đến consumer.
`ORDER_ITEM#...` và audit record không đi vào consumer.

Consumer ghi cùng table theo schema:

- `PK = AUDIT_LOG_ORDER#<orderId>`
- `SK = EVENT#<thời gian Stream event>#<eventID>`
- `entityType = AUDIT_LOG_ORDER`, `eventName`, `previousStatus`, `status`,
  `occurredAt`, `sourceSK`, `sourceEventId`, `sourceSequenceNumber`

`INSERT` ghi trạng thái ban đầu. `MODIFY` chỉ ghi khi `status` thay đổi;
các cập nhật khác như thêm payment reference được bỏ qua. `REMOVE` ghi trạng
thái cuối trước khi xóa. Hiện luồng order không chủ động xóa order, nhưng
consumer đã hỗ trợ sự kiện này. Audit không sao chép email hoặc toàn bộ order.

Key audit được tạo từ identity của Stream event, và `PutItem` có condition
chống ghi trùng khi Lambda retry. Consumer trả về failed sequence numbers để
retry phần batch lỗi; sau 5 lần retry, sự kiện lỗi được chuyển đến
`supermarket-order-audit-stream-dlq` và có CloudWatch alarm.

Stream chỉ bắt các thay đổi từ sau khi Stream được bật; mapping đọc từ đầu
Stream để không bỏ sót thay đổi xảy ra trong lúc deploy. Không backfill order cũ.
DynamoDB Streams lưu sự kiện tối đa 24 giờ. Với audit có
yêu cầu lưu lâu hơn, các audit record trong table là dữ liệu lưu trữ chính.

Để xem lịch sử một order, Query table bằng `PK = AUDIT_LOG_ORDER#<orderId>`
và `SK begins_with EVENT#`.
