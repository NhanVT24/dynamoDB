# Custom Domain: truyenmasinhvien.com

This project treats an "S3 custom domain" as a CloudFront custom domain in
front of an S3 bucket. Browser reads go through CloudFront; browser uploads
still use S3 presigned URLs.

## Target Domains

- `truyenmasinhvien.com`: frontend static site.
- `www.truyenmasinhvien.com`: frontend static site alias.
- `api.truyenmasinhvien.com`: API Gateway backend.
- `assets.truyenmasinhvien.com`: product images and public uploaded assets.

## Flow

```txt
Browser
  -> https://truyenmasinhvien.com
  -> Route53 A/AAAA Alias
  -> Frontend CloudFront
  -> private frontend S3 bucket

Browser
  -> https://api.truyenmasinhvien.com/api/...
  -> Route53 A/AAAA Alias
  -> API Gateway regional custom domain
  -> Lambda backend

Browser
  -> https://assets.truyenmasinhvien.com/public/products/image.png
  -> Route53 A/AAAA Alias
  -> ProductImages CloudFront
  -> ProductImages S3 bucket
```

For uploads:

```txt
Browser
  -> API asks for presigned upload URL
  -> API returns uploadUrl + fileUrl
  -> Browser PUTs file to S3 by uploadUrl
  -> Browser stores/renders fileUrl as https://assets.truyenmasinhvien.com/public/...
```

`S3_PUBLIC_BASE_URL` controls the returned `fileUrl`. CDK now sets it to the
first `productImagesDomainNames` value when that context is provided.

## What ACM Does

ACM is AWS Certificate Manager. It owns the TLS/HTTPS certificate for the
domain. CloudFront needs this certificate so a browser can trust:

```txt
https://truyenmasinhvien.com
https://assets.truyenmasinhvien.com
```

Without ACM, CloudFront can still serve `*.cloudfront.net`, but it cannot
correctly serve HTTPS for your custom domain.

CloudFront requires its ACM certificate to be in `us-east-1`.

API Gateway regional custom domains require their ACM certificate in the API
region, which is `ap-southeast-1` for this stack.

## Step 1: Create Route53 Hosted Zone

Run this only if `truyenmasinhvien.com` does not already have a Route53 hosted
zone in this AWS account.

```powershell
npm run cdk:aws:deploy:domain-hosted-zone -- `
  -c route53HostedZoneDomainName=truyenmasinhvien.com
```

Read the `HostedZoneNameServers` output and set those nameservers at the domain
registrar. If the domain was bought outside AWS, this registrar step is manual.
CDK cannot change nameservers at an external registrar.

## Step 2: Create CloudFront Certificate

This certificate covers the frontend and assets domains.

```powershell
npm run cdk:aws:deploy:frontend-certificate -- `
  -c frontendCertificateDomainName=truyenmasinhvien.com `
  -c frontendCertificateHostedZoneDomainName=truyenmasinhvien.com `
  -c frontendCertificateSubjectAlternativeNames=www.truyenmasinhvien.com,assets.truyenmasinhvien.com
```

Copy the `FrontendCertificateArn` output. It looks like:

```txt
arn:aws:acm:us-east-1:123456789012:certificate/...
```

## Step 2b: Create API Gateway Certificate

Use a separate API certificate in `ap-southeast-1`.

```powershell
npm run cdk:aws:deploy:api-certificate -- `
  -c apiCertificateDomainName=api.truyenmasinhvien.com `
  -c apiCertificateHostedZoneDomainName=truyenmasinhvien.com
```

Copy the `FrontendCertificateArn` output. Even though the output name is
generic, this stack is `SupermarketApiCertificateStack`, so the ARN is the API
certificate ARN in `ap-southeast-1`.

## Step 3: Deploy Backend Assets Domain

This attaches both backend custom domains:

- `api.truyenmasinhvien.com` to API Gateway.
- `assets.truyenmasinhvien.com` to the product images CloudFront distribution.

It also creates Route53 A/AAAA Alias records and injects
`S3_PUBLIC_BASE_URL=https://assets.truyenmasinhvien.com` into Lambda.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -SkipFrontendCloudFront `
  -ApiCustomDomainName "api.truyenmasinhvien.com" `
  -ApiCertificateArn "arn:aws:acm:ap-southeast-1:123456789012:certificate/..." `
  -ApiHostedZoneDomainName "truyenmasinhvien.com" `
  -ProductImagesDomainNames "assets.truyenmasinhvien.com" `
  -ProductImagesCertificateArn "arn:aws:acm:us-east-1:123456789012:certificate/..." `
  -ProductImagesHostedZoneDomainName "truyenmasinhvien.com"
```

## Step 4: Deploy Frontend Domain

This attaches `truyenmasinhvien.com` and `www.truyenmasinhvien.com` to the
frontend CloudFront distribution and creates Route53 A/AAAA Alias records.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -FrontendCloudFrontOnly `
  -FrontendDomainNames "truyenmasinhvien.com,www.truyenmasinhvien.com" `
  -FrontendCertificateArn "arn:aws:acm:us-east-1:123456789012:certificate/..." `
  -FrontendHostedZoneDomainName "truyenmasinhvien.com" `
  -FrontendApiOriginDomainName "b5j3895qth.execute-api.ap-southeast-1.amazonaws.com" `
  -FrontendApiOriginPath "/prod"
```

## Step 5: Update App Callback URLs

After the frontend domain works, deploy backend parameters that depend on the
frontend URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -SkipFrontendCloudFront `
  -CallbackUrl "https://truyenmasinhvien.com/auth/callback" `
  -LogoutUrl "https://truyenmasinhvien.com/" `
  -VnpayReturnUrl "https://truyenmasinhvien.com/store/checkout/result" `
  -ApiCustomDomainName "api.truyenmasinhvien.com" `
  -ApiCertificateArn "arn:aws:acm:ap-southeast-1:123456789012:certificate/..." `
  -ApiHostedZoneDomainName "truyenmasinhvien.com" `
  -ProductImagesDomainNames "assets.truyenmasinhvien.com" `
  -ProductImagesCertificateArn "arn:aws:acm:us-east-1:123456789012:certificate/..." `
  -ProductImagesHostedZoneDomainName "truyenmasinhvien.com"
```

## Code Map

- Hosted zone: `infra/stack/domain-hosted-zone-stack.ts`
- Certificate: `infra/stack/frontend-certificate-stack.ts`
- Frontend CloudFront custom domain: `infra/stack/frontend-cloudfront-stack.ts`
- Assets/S3 CloudFront custom domain: `infra/stack/aws-api-stack.ts`
- Deploy wrapper parameters: `scripts/deploy-aws.ps1`
