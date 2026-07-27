# Supermarket Shopping — Next.js + Node.js + DynamoDB

Ứng dụng học DynamoDB bằng bài toán quản lý mua sắm siêu thị.

## Chạy dự án

```bash
npm install
npm run db:up
npm run db:init
npm run db:seed
npm run dev
```

Web: `http://localhost:3000`

API: `http://localhost:4000`

## DynamoDB Commands

| Thao tác | Endpoint | DynamoDB command |
| --- | --- | --- |
| Thêm mặt hàng | `POST /api/shopping-items` | `PutCommand` |
| Đọc một mặt hàng | `GET /api/shopping-items/:id` | `GetCommand` |
| Tải danh sách | `GET /api/shopping-items` | `ScanCommand` |
| Sửa mặt hàng | `PATCH /api/shopping-items/:id` | `UpdateCommand` |
| Xóa mặt hàng | `DELETE /api/shopping-items/:id` | `DeleteCommand` |

## Single-table Keys

| Entity | PK | SK | GSI1PK | GSI1SK |
| --- | --- | --- | --- | --- |
| Shopping item | `SHOPPING_ITEM#id` | `DETAIL` | `CATEGORY#category` | `ITEM#name#id` |

## Shopping Item Fields

| Field | Kiểu | Tác dụng |
| --- | --- | --- |
| `name` | string | Tên mặt hàng |
| `category` | string | Nhóm hàng |
| `quantity` | number | Số lượng |
| `unitPrice` | number | Đơn giá dạng số, dùng để tính tổng |
| `priceLabel` | string | Đơn giá dạng chuỗi để hiển thị, ví dụ `185.000đ / túi` |
| `purchased` | boolean | Đã mua hay chưa |
| `version` | number | Số phiên bản item, dùng cho optimistic locking khi update |
