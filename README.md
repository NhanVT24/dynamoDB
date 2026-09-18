# Supermarket Platform

Monorepo cho nen tang supermarket gom frontend Next.js, backend NestJS/Fastify va AWS CDK infrastructure.

## Main Routes

- `http://localhost:3000/admin`: admin console.
- `http://localhost:3000/store`: customer storefront.
- `http://localhost:3000/`: redirect theo session hien tai.

## Repository Structure

### Web

- `apps/web/app`: Next.js App Router routes.
- `apps/web/src/features/admin`: admin screens va reusable admin components.
- `apps/web/src/features/auth`: Cognito client-side auth helpers.

### API

- `apps/api/src/core/app`: Nest app bootstrap va shared app module factory.
- `apps/api/src/modules`: business modules theo domain: storefront, shopping, sales, payments, notifications, uploads, authorization.
- `apps/api/src/integrations`: AWS/external integrations nhu SES, SQS, SNS, EventBridge.
- `apps/api/src/database`: DynamoDB client va key helpers.
- `apps/api/src/entrypoints/http`: local/server HTTP entrypoint.
- `apps/api/src/entrypoints/lambda/http`: API Gateway Lambda entrypoints.
- `apps/api/src/entrypoints/lambda/queue`: SQS worker Lambda entrypoints.
- `apps/api/src/entrypoints/lambda/jobs`: scheduled/event job Lambda entrypoints.
- `apps/api/src/entrypoints/lambda/workflow`: Step Functions task Lambda entrypoints.
- `apps/api/src/entrypoints/lambda/cognito`: Cognito trigger Lambda entrypoints.
- `apps/api/src/entrypoints/lambda/shared`: reusable Lambda handler factories.
- `apps/api/src/scripts`: operational scripts cho seed, backfill, localization va data cleanup.

### Infra

- `infra/bin/aws-api.ts`: CDK app entry.
- `infra/lib/aws-api-stack.ts`: AWS stack chinh.
- `scripts`: workspace-level deploy/manual AWS operation helpers.
- `docs`: operational notes va service-specific runbooks.

## Local Development

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

## Refactor Notes

- Lambda CDK handlers tro thang vao `apps/api/src/entrypoints/lambda`.
- Wrapper cu `apps/api/src/lambda` da duoc loai bo.
- BE test-only scripts va `apps/api/tests` da duoc loai bo khoi runtime source tree.
