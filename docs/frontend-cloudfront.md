# Frontend CloudFront Trial

## What This Stack Creates

`SupermarketFrontendCloudFrontStack` is separate from the backend stack and creates:

- A private S3 bucket for frontend static files.
- A CloudFront distribution with Origin Access Control.
- A viewer-request CloudFront Function for clean frontend routes.
- Optional `/api/lambda-proxy/*` behavior to proxy requests to API Gateway.

The bucket is intentionally private. Viewers can read files only through CloudFront.

## Deploy

Deploy backend and frontend CloudFront stack together:

```powershell
npm run deploy:aws -- -FrontendApiOriginDomainName rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com -FrontendApiOriginPath /prod
```

Deploy only the frontend CloudFront stack:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 -FrontendCloudFrontOnly -FrontendApiOriginDomainName rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com -FrontendApiOriginPath /prod
```

Deploy only the backend stack:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 -SkipFrontendCloudFront
```

After the stack exists, build and upload the static frontend files:

```powershell
npm run deploy:frontend:static
```

The static deploy script uploads hashed Next.js assets under `_next/static/*` with long immutable cache headers, then uploads HTML/documents with `no-cache,no-store,must-revalidate`. It intentionally does not delete old `_next/static/*` files during normal deploys, because an old cached HTML document can still reference an older hashed JS chunk for a short time.

For a custom domain, the ACM certificate ARN must be from `us-east-1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -FrontendCloudFrontOnly `
  -FrontendDomainNames "shop.example.com" `
  -FrontendCertificateArn "arn:aws:acm:us-east-1:123456789012:certificate/..." `
  -FrontendApiOriginDomainName "rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com" `
  -FrontendApiOriginPath "/prod"
```

If the domain is hosted in Route 53, CDK can create the CloudFront ACM
certificate for you:

```powershell
npm run cdk:aws:deploy:frontend-certificate -- `
  -c frontendCertificateDomainName=shop.example.com `
  -c frontendCertificateHostedZoneDomainName=example.com
```

For a wildcard certificate:

```powershell
npm run cdk:aws:deploy:frontend-certificate -- `
  -c frontendCertificateDomainName=example.com `
  -c frontendCertificateHostedZoneDomainName=example.com `
  -c frontendCertificateSubjectAlternativeNames=*.example.com
```

This certificate stack is created in `us-east-1`, which is required by
CloudFront. Use its `FrontendCertificateArn` output as `-FrontendCertificateArn`
when deploying the frontend distribution.

## Current Frontend Constraint

The current `apps/web` build is configured for static export. S3 can store files, but it cannot run a Next.js server. Keep API traffic behind API Gateway and CloudFront behaviors.

The optional API behavior keeps the existing `/api/lambda-proxy/*` browser calls working by rewriting them to the API Gateway origin.

When deploying through `scripts/deploy-aws.ps1`, frontend-specific values are passed to CDK as context flags so the deployed CloudFormation template keeps the API origin/behavior.

## Public S3 Assets Through Frontend CloudFront

To let the frontend CloudFront distribution serve product images stored in the
product images S3 bucket, pass the bucket regional S3 domain as an extra origin:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -FrontendCloudFrontOnly `
  -FrontendPublicAssetsOriginDomainName "supermarketawsstack-productimagesbucket03bda4c8-u88kfbwbooqy.s3.ap-southeast-1.amazonaws.com"
```

This makes both `/public/*` and `/admin/public/*` work through the frontend
CloudFront domain. `/admin/public/*` is rewritten to `/public/*` before the
request is sent to S3.
