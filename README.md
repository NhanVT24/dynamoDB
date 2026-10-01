# Supermarket Shopping Platform

Supermarket Shopping Platform is a production-oriented ecommerce system built on AWS. It includes a customer storefront, an admin console, a NestJS backend API, VNPAY payment flows, SES email notifications, Cognito-based authentication, file storage, asynchronous workers, and audit logging for important business changes.

The project is organized as a TypeScript monorepo with clear boundaries between frontend, backend, infrastructure, operational scripts, and technical runbooks.

## System Overview

- Customer storefront for browsing products, checkout, order tracking, and profile management.
- Admin console for product operations, inventory, email, storage, user permissions, and audit history.
- Backend API for products, orders, payments, refunds, authorization, notifications, reporting, and operational workflows.
- Asynchronous processing through SQS, EventBridge, and Lambda workers.
- Audit logging for changes across orders, payments, and user authorization/profile data.
- AWS infrastructure managed with CDK and CloudFormation.

## Tech Stack

### Frontend

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Cognito Hosted UI / JWT session handling
- Static export deployed through S3 and CloudFront

### Backend

- NestJS 11
- Fastify
- TypeScript
- Zod and class-validator
- AWS SDK v3
- Lambda-compatible entrypoints

### Data, Auth, Payment, Email

- DynamoDB single-table design for core business data
- DynamoDB Streams for audit and event-driven flows
- Amazon Cognito for authentication and authorization claims
- VNPAY for payment and refund flows
- Amazon SES with SNS feedback for email delivery tracking
- S3 for public/private object storage

### Infrastructure

- AWS CDK v2
- CloudFormation
- API Gateway
- AWS Lambda
- SQS FIFO queues and DLQs
- EventBridge and EventBridge Pipes
- CloudFront
- Route 53
- ACM
- CloudWatch

## High-Level Architecture

```text
Browser
  -> CloudFront
  -> Static Next.js app on private S3
  -> API Gateway
  -> Lambda NestJS/Fastify API
  -> DynamoDB / S3 / Cognito / SES / VNPAY

DynamoDB Streams
  -> EventBridge Pipe
  -> FIFO SQS
  -> Audit Worker Lambda
  -> Audit Log DynamoDB Table

EventBridge / SQS
  -> Worker Lambdas
  -> Order, payment, email, image, report, and cleanup workflows
```

## Repository Structure

```text
apps/
  web/                  Next.js storefront and admin console
  api/                  NestJS/Fastify backend

infra/
  bin/                  CDK app entrypoint
  stack/                CDK stack definitions
  module/               Reusable CDK resource builders

scripts/                Deployment and operational scripts
docs/                   Runbooks and technical notes
```

Key areas:

- `apps/web/app`: storefront routes, checkout, orders, products, and profile pages.
- `apps/web/src/features/admin`: admin console, permissions, audit viewer, email, storage, and product management.
- `apps/web/src/features/auth`: browser-side Cognito auth helpers.
- `apps/api/src/modules`: backend business modules grouped by domain.
- `apps/api/src/entrypoints/lambda`: HTTP, queue, scheduled job, workflow, and Cognito trigger entrypoints.
- `apps/api/src/integrations`: AWS and external service adapters.
- `apps/api/src/database`: DynamoDB client and key helpers.
- `infra/stack`: main CDK stack definitions.

## Main AWS Stacks

- `SupermarketAwsStack`: backend API, Cognito, DynamoDB, Lambda, SQS, EventBridge, SES, alarms, and shared backend resources.
- `SupermarketAuditLogStreamStack`: EventBridge Pipe from DynamoDB Stream to the audit FIFO queue.
- `SupermarketFrontendCloudFrontStack`: private S3 frontend bucket, CloudFront distribution, and static route handling.
- `SupermarketS3StorageStack`: public/private object storage.
- `SupermarketDomainHostedZoneStack`: Route 53 hosted zone.
- `SupermarketFrontendCertificateStack`: ACM certificate for the CloudFront domain.
- `SupermarketApiCertificateStack`: ACM certificate for the API custom domain.

## Local Development

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

Default local routes:

- `http://localhost:3000/store`
- `http://localhost:3000/admin`
- `http://localhost:4000/health`

Run each side separately:

```bash
npm run dev:web
npm run dev:api
```

## Validation

```bash
npm run typecheck
npx tsc -p infra/tsconfig.json --noEmit
```

## Deployment

A full production release should deploy backend and infrastructure changes, build the frontend, upload static assets to S3, and invalidate CloudFront. Deploying CDK stacks alone does not update the production frontend assets.

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile <profile> -DomainName <domain>
```

Deploy only frontend static assets:

```powershell
npm run deploy:frontend:static -- -AwsProfile <profile>
```

## Related Documentation

- `docs/deploy-stacks.md`: deployment flow and stack boundaries.
- `docs/frontend-cloudfront.md`: static frontend hosting on S3 and CloudFront.
- `docs/audit-log-stream.md`: audit logging through DynamoDB Streams.
- `docs/audit-log-whitelist.md`: audited fields and sensitive-field denylist.
- `docs/vnpay-refund.md`: VNPAY refund flow.
- `docs/vnpay-ipn-checklist.md`: VNPAY IPN verification checklist.
- `docs/ses-feedback.md`: SES feedback through SNS, Lambda, and DynamoDB.
- `docs/custom-domain-truyenmasinhvien.md`: custom domain and routing notes.

## Engineering Notes

- Local typecheck/build proves code readiness, not that AWS production is updated.
- Payment, queue worker, and audit flows rely on idempotency, retries, timeouts, conditional writes, and DLQs.
- Audit logs can identify an actor only when the mutating code writes actor metadata before the DynamoDB Stream event is emitted.
- Do not log passwords, tokens, raw payment payloads, or sensitive customer data.
