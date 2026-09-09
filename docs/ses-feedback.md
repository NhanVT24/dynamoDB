# SES → SNS → Lambda → DynamoDB

## Cấu hình và deploy

CDK tạo/cấu hình các resource trong cùng region:

- SES Configuration Set: `supermarket-inventory-daily-report` (giữ tên cũ để tương thích).
- Event destination SNS bật Send, Delivery, Bounce, Complaint, Reject, DeliveryDelay, RenderingFailure.
- SNS topic: `supermarket-inventory-report-events`, policy chỉ cho SES publish từ configuration set/account này.
- SNS subscription gọi `supermarket-ses-inventory-event-aws`; CDK cấp quyền invoke cho topic.
- Lambda nhận `SES_EVENTS_TOPIC_ARN`, quyền DynamoDB và cấu hình retry.
- `supermarket-ses-feedback-dlq` giữ event không xử lý được tối đa 14 ngày; CloudWatch alarm khi có message.

Chạy tại workspace root sau khi kiểm tra AWS profile/account đích:

```powershell
npm run cdk:aws:synth
npm run deploy:aws -- -AwsProfile nhandev
```

Deploy script cập nhật toàn bộ stack, không chỉ SES. Đọc CDK diff trước khi deploy trên production.
Không cần nhập callback URL trong SES: SNS subscription dùng Lambda ARN, AWS tự gọi Lambda.
Không cần verify HTTP signature trong Lambda integration; dùng SNS resource policy, Lambda invoke permission và kiểm tra TopicArn.

Điều kiện SES riêng của account: `SES_FROM_EMAIL` hoặc domain phải được verified; nếu account còn sandbox thì địa chỉ nhận cũng phải verified (ngoại trừ SES mailbox simulator). Production access và DNS verification không được script này tự hoàn tất.

Nếu chạy sender local, đặt `SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME=supermarket-inventory-daily-report`.
Tracked mailer sẽ từ chối gửi nếu thiếu configuration set, tránh gửi email không có feedback.

## Dữ liệu và thời điểm update

```text
Trước khi gửi: EMAIL#e1 / META (sender, subject, recipientCount, sendStatus)
              EMAIL#e1 / RECIPIENT#r1  (recipientEmail, recipientType, status=pending)
Gửi SES:      ConfigurationSetName + EmailTags(emailId=e1, recipientId=r1)
SES accept:   META.sendStatus=accepted, META.sesMessageId=...
SES event:    mail.tags → tìm child → conditional UpdateItem
```

META giữ sender, subject, email type, liên kết nghiệp vụ, SES message ID và trạng thái submit chung.
RECIPIENT là source of truth cho trạng thái từng mailbox. Child không copy subject, sender, email type, reportId, relatedId hay SES message ID.
SES chủ động publish feedback; backend không poll DynamoDB để tạo ra status mới.
UI có thể refresh DB 5–15 giây khi người dùng đang xem, dừng khi đóng trang. Đây là hướng dẫn UI, chưa thêm polling UI.
`delivered` nghĩa recipient mail server đã nhận, không đảm bảo inbox placement hay người dùng đã đọc.

Consumer dùng `delivery.timestamp`, `bounce.timestamp`, v.v.; không lấy thời gian gửi ban đầu làm thời gian giao mail.
Một event lặp lại không update lần hai. Conditional update kiểm tra trạng thái hiện tại và SES MessageId để bảo vệ race.
Complaint là feedback sau delivery hợp lệ; delayed bounce cũng có thể theo sau delivery. Non-terminal Send/Delay không ghi đè kết quả cuối.
`statusAt` là timestamp provider của event đã tạo ra status hiện tại; không lưu riêng deliveredAt/bouncedAt/complainedAt/providerEventAt.

Nếu một email có nhiều To/CC/BCC và chỉ tag emailId, consumer query children rồi chỉ update địa chỉ trong danh sách affected recipients của event. Không dùng mail.destination để suy diễn tất cả người nhận đều delivered/bounced.
Complaint của email nhiều người nhận có thể chỉ xác định được nhóm địa chỉ nghi vấn do ISP ẩn danh; không đảm bảo biết chính xác cá nhân. Với campaign cần attribution chính xác, mỗi SES bulk entry nên chứa một recipient.

Event cũ không có recipientId vẫn có thể update item EMAIL#id / DETAIL. Không xóa hoặc migrate dữ liệu cũ tự động.
Retry gửi email phải tạo attempt riêng; không gắn MessageId mới vào record của attempt cũ.

## Retry và vận hành

- SNS không gọi được Lambda: SNS subscription DLQ.
- Lambda đã được invoke nhưng xử lý thất bại: Lambda async retry tối đa 2 lần, event age tối đa 6 giờ, sau đó failure destination DLQ.
- Hai dạng envelope khác nhau cùng nằm trong DLQ: SNS message trực tiếp hoặc Lambda failure record chứa requestPayload. Khi replay phải lấy đúng SNS event gốc.
- Record không tồn tại, JSON không hợp lệ hoặc DB unavailable phải gây lỗi để retry, không âm thầm acknowledge.
- Log chỉ correlation IDs/status, không dump mail headers hay BCC. Hạn chế quyền đọc DLQ vì payload có thể chứa thông tin người nhận.
- Event chứa reportId cập nhật thêm projection inventory report; nếu một trong hai write thất bại, retry thực hiện an toàn phần còn lại.
- Lưu complaint ở đây phục vụ tracking. Chưa triển khai unsubscribe/suppression nghiệp vụ hoặc tự động retry gửi campaign.

## Kiểm thử

```powershell
npm run test:email-feedback -w @supermarket/api
```

Test mock AWS client, không gửi email, không ghi DB thật. Kiểm tra từng event type, duplicate, out-of-order, affected To/CC/BCC, legacy schema, sai topic/MessageId và lỗi DB.

Sau deploy, kiểm thử AWS thật bằng các địa chỉ SES simulator (các lệnh này thực sự gửi mail test và ghi DB):

```powershell
npm run mail:test:ses-simulator -w @supermarket/api -- --scenario=success
npm run mail:test:ses-bounce -w @supermarket/api
npm run mail:test:ses-complaint -w @supermarket/api
npm run mail:test:ses-all -w @supermarket/api
npm run mail:test:ses-layout-simulator -w @supermarket/api
```

CLI in emailId; kiểm tra PK `EMAIL#<emailId>`, SK `RECIPIENT#<emailId>`, status tương ứng delivered/bounced/complained. Xem log Lambda và DLQ nếu status chưa cập nhật. Dùng strongly consistent read trên base table khi kiểm tra ngay sau event.

Tài liệu AWS:
- https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html
- https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
