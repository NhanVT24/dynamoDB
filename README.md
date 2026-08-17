# Supermarket Platform

Monorepo cho nền tảng supermarket gồm:

- `apps/web`: frontend Next.js, gom cả khu `admin` và `customer/store`
- `apps/api`: backend NestJS/Fastify, tổ chức lại theo `core/`, `modules/`, `entrypoints/`
- `infra`: CDK stack deploy AWS

## Route chính

- `http://localhost:3000/admin`: giao diện admin
- `http://localhost:3000/store`: giao diện customer/storefront
- `http://localhost:3000/`: tự điều hướng sang `admin` hoặc `store` theo session hiện tại

## Cấu trúc mới

### Web

- `app/admin`: route admin
- `app/store`: route customer/storefront
- `src/features/admin`: màn hình và component quản trị
- `src/features/auth`: logic Cognito client-side

### API

- `src/core/app`: bootstrap app và `AppModule`
- `src/modules`: business modules
- `src/integrations`: S3, SQS, SES, EventBridge
- `src/entrypoints/http`: entrypoint chạy server
- `src/entrypoints/lambda`: entrypoint Lambda theo nhóm `http`, `queue`, `jobs`

### Infra

- `infra/bin/aws-api.ts`: CDK entry
- `infra/lib/aws-api-stack.ts`: AWS stack chính

## Chạy local

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

## Deploy AWS

```bash
npm run cdk:aws:bootstrap
npm run cdk:aws:deploy
```

## Ghi chú

- LocalStack và các script/stack liên quan đã được loại bỏ khỏi repo.
- Các file entry cũ trong `apps/api/src` đang giữ làm wrapper mỏng để tránh gãy handler/CDK trong lúc chuyển cấu trúc.
