# Student Management — Next.js + Node.js + DynamoDB

Khung học tập quản lý sinh viên theo mô hình monorepo:

- `apps/web`: Next.js App Router, TypeScript
- `apps/api`: Node.js, Fastify, AWS SDK v3, TypeScript
- DynamoDB Local + DynamoDB Admin bằng Docker

## Chạy dự án

Yêu cầu: Node.js 20+, npm 10+, Docker.

```bash
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.local.example apps\web\.env.local
npm install
npm run db:up
npm run db:init
npm run db:seed
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000
- DynamoDB Admin: http://localhost:8001

## Mô hình single-table

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Student | `STUDENT#id` | `PROFILE` | `EMAIL#email` | `STUDENT#id` |
| Course | `COURSE#id` | `META` | `DEPARTMENT#name` | `COURSE#code` |
| Enrollment | `STUDENT#id` | `COURSE#id` | `COURSE#id` | `STUDENT#id` |

Access patterns chính:

1. Lấy/cập nhật/xóa sinh viên theo id.
2. Kiểm tra email duy nhất qua GSI1.
3. Liệt kê sinh viên bằng `Scan` + cursor (chỉ để học; production thường cần index).
4. Lấy các môn của một sinh viên bằng `Query` trên PK.
5. Lấy sinh viên trong một môn bằng `Query` trên GSI1.
6. Ghi đăng ký môn + cập nhật sĩ số bằng transaction.
7. Import nhiều bản ghi bằng batch write.
8. Chống ghi đè bằng conditional expression và trường `version`.

## Lộ trình TODO

Tìm toàn bộ bài tập bằng:

```bash
rg TODO apps/api
```

Thứ tự đề xuất:

1. Hoàn thiện validation và CRUD course.
2. Làm enrollment transaction.
3. Query hai chiều Student ↔ Course qua GSI.
4. Pagination bằng `LastEvaluatedKey`.
5. Batch import và xử lý `UnprocessedItems`.
6. Optimistic locking với `version`.
7. TTL cho audit/session item.
8. Streams + Lambda (bước cloud, không nằm trong local scaffold).

> Không commit credentials thật. Khi deploy AWS, bỏ `DYNAMODB_ENDPOINT` và dùng IAM role.
