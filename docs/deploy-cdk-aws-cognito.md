# Deploy AWS CDK + Cognito co ban

Tai lieu nay huong dan deploy stack AWS that bang `AWS CDK + CloudFormation`, giu muc cau hinh co ban de de nam trong free tier nhat co the.

## 1. Muc tieu

Stack AWS moi tao:

- 1 DynamoDB table `MarketplaceProducts`
- 1 Lambda `supermarket-api-aws`
- 1 API Gateway REST API
- 1 Cognito User Pool
- 1 Cognito App Client
- 1 Cognito Hosted UI domain
- 1 Cognito authorizer cho API Gateway

Muc free-tier-friendly hien tai:

- DynamoDB `PAY_PER_REQUEST`
- Cognito `email sign-in`
- khong bat `SMS MFA`
- khong bat `advanced security`
- khong dung `multi-region replication`

## 2. File moi trong repo

- `infra/bin/aws-api.ts`
- `infra/lib/aws-api-stack.ts`

Stack local cho LocalStack van giu nguyen, khong bi anh huong.

## 3. Dieu can cai truoc

Can co:

- Node.js
- AWS CLI
- AWS CDK CLI

Dang nhap AWS CLI:

```bash
aws configure
```

Kiem tra account va region:

```bash
aws sts get-caller-identity
aws configure get region
```

Neu ban chua co region mac dinh, co the dat tam:

```bash
set AWS_REGION=ap-southeast-1
```

## 4. Build Lambda artifact

CDK stack nay deploy tu artifact da package san cua API:

```bash
npm run build:lambda
```

## 5. Bootstrap CloudFormation/CDK

Moi account + region can bootstrap 1 lan:

```bash
npm run cdk:aws:bootstrap
```

## 6. Synth stack

Xem CloudFormation template truoc:

```bash
npm run cdk:aws:synth
```

## 7. Tao SSM parameter truoc khi deploy

Stack AWS doc Google OAuth config tu SSM Parameter Store:

- `/supermarket/google/client-id`
- `/supermarket/google/client-secret`

Tao parameter bang AWS CLI:

```bash
aws ssm put-parameter --name "/supermarket/google/client-id" --type "String" --value "YOUR_GOOGLE_CLIENT_ID" --overwrite
aws ssm put-parameter --name "/supermarket/google/client-secret" --type "SecureString" --value "YOUR_GOOGLE_CLIENT_SECRET" --overwrite
```

Neu ban muon dung path khac, luc deploy co the override:

- `GoogleClientIdSsmPath`
- `GoogleClientSecretSsmPath`
- `GoogleClientSecretSsmVersion`

Mac dinh `GoogleClientSecretSsmVersion = 1`. Moi lan update secret bang `put-parameter --overwrite`, SSM se tang version, nen luc deploy lai can truyen dung version moi neu khong dung version `1`.

Co the xem version hien tai:

```bash
aws ssm get-parameter-history --name "/supermarket/google/client-secret"
```

## 8. Deploy stack

Deploy co ban:

```bash
npm run cdk:aws:deploy
```

CDK se hoi parameter. 6 parameter quan trong:

- `CallbackUrl`
- `LogoutUrl`
- `CognitoDomainPrefix`
- `GoogleClientIdSsmPath`
- `GoogleClientSecretSsmPath`
- `GoogleClientSecretSsmVersion`

Gia tri local de test frontend:

- `CallbackUrl`: `http://localhost:3000/auth/callback`
- `LogoutUrl`: `http://localhost:3000/`
- `CognitoDomainPrefix`: phai unique toan cau, vi du `supermarket-auth-tenban-2026`
- `GoogleClientIdSsmPath`: `/supermarket/google/client-id`
- `GoogleClientSecretSsmPath`: `/supermarket/google/client-secret`
- `GoogleClientSecretSsmVersion`: `1` hoac version secret hien tai trong SSM

Khong nen de gia tri mac dinh `replace-me-supermarket-auth` khi deploy that, vi kha nang cao se bi trung domain.

## 9. Output can luu lai

Sau khi deploy xong, ghi lai:

- `ApiGatewayUrl`
- `UserPoolId`
- `UserPoolClientId`
- `CognitoHostedUiDomain`

Day la cac bien sau nay frontend se dung de login that.

## 10. Can cau hinh them gi sau Cognito

Sau khi stack tao xong, ban thuong van can:

- tao route callback trong web, vi du `/auth/callback`
- doi popup mock thanh login that bang Cognito SDK
- goi API kem `Authorization: Bearer <token>`
- neu muon user tu dang ky va xac minh email, can test luong verify email

## 11. Chi phi co ban

De giu kha nang 0 USD cao nhat:

- giu user it hon 10,000 MAU / thang
- khong dung SMS MFA
- khong bat Plus tier
- khong bat advanced security

Thuc te stack nay thuong ton phi o:

- API Gateway
- Lambda
- DynamoDB
- email/SMS neu ban dung verify va MFA nang

Cognito co kha nang van la 0 USD neu luong user nho.

## 12. Neu deploy fail thi sao

Thong thuong khong can xoa het stack.

Luong binh thuong:

1. `UPDATE_IN_PROGRESS`
2. neu fail thi CloudFormation rollback
3. neu rollback xong thi stack ve `UPDATE_ROLLBACK_COMPLETE`
4. sau do sua code roi deploy lai

Chi khi stack roi vao `UPDATE_ROLLBACK_FAILED` thi moi can xu ly rollback truoc.

## 13. Xoa stack khi khong dung nua

Neu chi test free tier, nen xoa stack sau khi xong:

```bash
npm run cdk:aws:destroy
```

## 14. Ghi chu quan trong

- `CognitoDomainPrefix` phai unique toan cau
- `RemovalPolicy.DESTROY` dang duoc dat cho demo/development de de cleanup
- stack hien tai dang mo `GET /` va `GET /health` khong can auth de de test healthcheck
- cac endpoint khac se di qua Cognito authorizer
- parameter Google secret dang doc tu SSM `SecureString`, khong con truyen truc tiep secret qua CDK prompt nua
