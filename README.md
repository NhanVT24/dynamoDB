# Admin quản lý sản phẩm - Next.js + Node.js + DynamoDB

Ứng dụng demo trang admin quản lý sản phẩm, dùng Next.js ở frontend, Fastify ở backend và DynamoDB single-table ở local.

## Nội dung đã chỉnh

- Chuyển model từ danh sách mua sắm sang quản lý sản phẩm.
- Thêm các trường hợp lý cho sản phẩm: `sku`, `brand`, `stock`, `price`, `originalPrice`, `status`, `rating`, `soldCount`, `featured`.
- Giao diện admin đơn giản: thẻ thống kê nằm ngang, bảng sản phẩm, form thêm/sửa, filter và phân trang.
- Backend dùng raw DynamoDB commands: `PutItemCommand`, `GetItemCommand`, `ScanCommand`, `QueryCommand`, `UpdateItemCommand`, `DeleteItemCommand`.
- Cấu hình local DynamoDB dùng LocalStack qua cổng `4566`.

## Cách chạy

```bash
npm install
npm run db:up
npm run db:init
npm run db:seed
npm run dev
```

Web: `http://localhost:3000`

API: `http://localhost:4000`

## Biến môi trường

Root `.env`:

```bash
PORT=4000
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
DYNAMODB_ENDPOINT=http://localhost:4566
DYNAMODB_TABLE_NAME=MarketplaceProducts
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Single-table design

Table dùng một bảng và một GSI:

| Entity | PK | SK | GSI1PK | GSI1SK |
| --- | --- | --- | --- | --- |
| Product | `PRODUCT#id` | `DETAIL` | `CATEGORY#category` | `STATUS#status#NAME#name#PRODUCT#id` |

Ý nghĩa:

- `PK/SK` lưu bản ghi chi tiết sản phẩm.
- `GSI1PK` gom sản phẩm theo danh mục.
- `GSI1SK` sắp theo trạng thái và tên để hỗ trợ filter/admin dashboard.

## Product fields

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | string | Tên sản phẩm |
| `category` | string | Danh mục chính |
| `brand` | string | Thương hiệu |
| `sku` | string | Mã sản phẩm nội bộ |
| `stock` | number | Tồn kho hiện tại |
| `price` | number | Giá bán |
| `originalPrice` | number | Giá gốc để hiển thị khuyến mãi |
| `status` | string | `active`, `low_stock`, `out_of_stock` |
| `rating` | number | Đánh giá trung bình |
| `soldCount` | number | Lượt bán |
| `featured` | boolean | Sản phẩm nổi bật |
| `version` | number | Optimistic locking khi update |

## API chính

| Tác vụ | Endpoint | DynamoDB command |
| --- | --- | --- |
| Thêm sản phẩm | `POST /api/shopping-items` | `PutItemCommand` |
| Đọc sản phẩm | `GET /api/shopping-items/:id` | `GetItemCommand` |
| Lọc theo danh mục | `GET /api/shopping-items?category=Dien%20tu` | `QueryCommand` |
| Tải danh sách | `GET /api/shopping-items?page=1&limit=8` | `ScanCommand` hoặc `QueryCommand` |
| Sửa sản phẩm | `PATCH /api/shopping-items/:id` | `UpdateItemCommand` |
| Tăng/giảm tồn kho | `PATCH /api/shopping-items/:id/increment` | `UpdateItemCommand` |
| Xóa sản phẩm | `DELETE /api/shopping-items/:id` | `DeleteItemCommand` |

## Ghi chú

- `npm run db:seed` có kiểm tra dữ liệu cũ, nếu bảng đã có sản phẩm thì script sẽ bỏ qua.
- Nếu Windows báo lỗi `.next/trace`, hãy dừng các tiến trình Node cũ rồi chạy lại `npm run dev`.
- Hướng dẫn deploy riêng `apps/api` lên AWS Lambda nằm ở [docs/deploy-lambda-api.md](/D:/JAVA/Doan/dynamoDB/docs/deploy-lambda-api.md).
