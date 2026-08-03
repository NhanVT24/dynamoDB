# Deploy TypeScript CDK len LocalStack

Tai lieu nay thay the huong `SAM` bang `TypeScript + AWS CDK`, va target deploy la `LocalStack`.

## 1. Cau truc moi

- `infra/bin/localstack-api.ts`: entrypoint CDK app
- `infra/lib/localstack-api-stack.ts`: stack khai bao Lambda + DynamoDB + Function URL
- `infra/tsconfig.json`: config TypeScript cho CDK app
- root `package.json`: script deploy LocalStack bang `cdklocal`

Backend `Fastify` khong doi. CDK chi dung artifact da duoc dong goi tu:

- `apps/api/dist/lambda`

## 2. Cong cu can co

Can cai:

- Docker
- LocalStack
- `aws-cdk`
- `aws-cdk-local`

Theo LocalStack docs, `cdklocal` la wrapper de CDK target LocalStack:
https://docs.localstack.cloud/aws/connecting/infrastructure-as-code/aws-cdk/

Lenh cai nhanh:

```bash
npm install
npm install -g aws-cdk aws-cdk-local
```

## 3. Chay LocalStack

Repo da co `docker-compose.yml`, nen chay:

```bash
npm run db:up
```

Kiem tra health:

```bash
curl http://localhost.localstack.cloud:4566/_localstack/health
```

## 4. Bootstrap CDK tren LocalStack

```bash
npm run cdk:local:bootstrap
```

Luu y:

- LocalStack docs khuyen uu tien recreate stack hon la update stack
- CDK asset deployment tren LocalStack can ho tro asset deployment cua LocalStack

## 5. Deploy stack local

Artifact Lambda duoc package tu app hien tai, sau do CDK deploy stack:

```bash
npm run cdk:local:deploy
```

Lenh nay se:

1. chay `npm run build:lambda`
2. dung `cdklocal` deploy stack `SupermarketApiLocalStack`
3. tao DynamoDB table `MarketplaceProducts`
4. tao Lambda `supermarket-api-localstack`
5. tao Function URL local

## 6. Tai nguyen duoc tao

Stack hien tai tao:

- 1 DynamoDB table `MarketplaceProducts`
- 1 Lambda function `supermarket-api-localstack`
- 1 Lambda Function URL

## 7. Test

Sau khi deploy xong, lay Function URL trong output stack va test:

```text
GET http://....lambda-url.ap-southeast-1.localhost.localstack.cloud:4566/health
```

Neu muon seed data vao table LocalStack:

```bash
npm run db:seed
```

Neu can backfill du lieu cu:

```bash
npm run db:backfill-products -w @supermarket/api
```

## 8. Lenh hay dung

Bootstrap:

```bash
npm run cdk:local:bootstrap
```

Synth:

```bash
npm run cdk:local:synth
```

Deploy:

```bash
npm run cdk:local:deploy
```

Destroy:

```bash
npm run cdk:local:destroy
```

## 9. Ghi chu

- `SAM` va `template.yaml` co the giu lai de tham khao, nhung huong deploy moi la CDK.
- Neu LocalStack update stack loi, thu `destroy` roi `deploy` lai.
- Theo docs LocalStack, CDK update tren LocalStack co the khong on dinh bang recreate stack.
