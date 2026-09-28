# Hoàn tiền VNPAY trong 5 phút

- Khách có thể gửi yêu cầu trong 5 phút kể từ `vnp_PayDate` đã được xác thực. Trang chi tiết đơn tự đếm ngược và disable nút khi hết hạn. API cũng kiểm tra lại và dùng DynamoDB conditional update để chặn request muộn hoặc đồng thời.
- Backend lưu `paymentTxnRef`, thời gian tạo giao dịch VNPAY và `refundRequestId` duy nhất. Một đơn chỉ gửi một yêu cầu refund. Khi VNPAY timeout hoặc response không xác thực được, đơn giữ `refund_pending`; không gửi lại với ID mới.
- `refund_pending` nghĩa là chưa xác nhận kết quả. `refund_sent` tương ứng `vnp_TransactionStatus=06`: VNPAY đã gửi yêu cầu hoàn sang ngân hàng, chưa khẳng định tiền đã về tài khoản khách. `refund_rejected` tương ứng trạng thái bị từ chối. Khi chuyển sang `refund_sent`, tồn kho và `soldCount` được điều chỉnh trong cùng một DynamoDB transaction với đơn.
- Trang chi tiết gọi API tra cứu 15 giây một lần khi đang pending. Chỉ dùng kết quả `querydr` có chữ ký hợp lệ và đúng giao dịch hoàn toàn phần. Tài liệu công khai của VNPAY mô tả `querydr` là tra cứu giao dịch thanh toán; cần xác nhận với VNPAY trong sandbox xem API này có trả trạng thái refund của merchant hay không. Nếu không, trạng thái pending phải được đối soát trên Merchant View và cần bổ sung cơ chế đối soát phù hợp trước khi vận hành thực tế.
- Sandbox tự dùng `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`. Với merchant production, cấu hình CloudFormation `VnpayTransactionUrl` và `VnpayMerchantIp` theo thông tin VNPAY cung cấp. Không mở refund production khi hai giá trị này còn trống.
- Đơn cũ thiếu `paymentTxnRef` hoặc timestamp gốc không tự động đủ điều kiện hoàn tiền. Cần đối soát thủ công nếu muốn hỗ trợ chúng.

Tham khảo: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html
