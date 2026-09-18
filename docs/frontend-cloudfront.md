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

For a custom domain, the ACM certificate ARN must be from `us-east-1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -FrontendCloudFrontOnly `
  -FrontendDomainNames "shop.example.com" `
  -FrontendCertificateArn "arn:aws:acm:us-east-1:123456789012:certificate/..." `
  -FrontendApiOriginDomainName "rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com" `
  -FrontendApiOriginPath "/prod"
```

## Current Frontend Constraint

The current `apps/web` build is configured for static export. S3 can store files, but it cannot run a Next.js server. Keep API traffic behind API Gateway and CloudFront behaviors.

The optional API behavior keeps the existing `/api/lambda-proxy/*` browser calls working by rewriting them to the API Gateway origin.

When deploying through `scripts/deploy-aws.ps1`, frontend-specific values are passed to CDK as context flags so the deployed CloudFormation template keeps the API origin/behavior.
