# Lệnh deploy các AWS stack

Chạy các lệnh dưới đây bằng PowerShell tại thư mục gốc của repo. File này dùng
AWS profile `nhandev`, region `ap-southeast-1` và domain `truyenmasinhvien.com`.
Thay các giá trị này nếu môi trường của bạn khác.

## Chuẩn bị

```powershell
$awsProfile = "nhandev"
$domain = "truyenmasinhvien.com"
$env:AWS_PROFILE = $awsProfile
$env:AWS_REGION = "ap-southeast-1"

npm ci
aws sts get-caller-identity --profile $awsProfile
```

Nếu profile dùng AWS IAM Identity Center (SSO) và phiên đã hết hạn, chạy
`aws sso login --profile $awsProfile` rồi kiểm tra lại `get-caller-identity`.

Nếu account/region chưa được CDK bootstrap, chạy một lần:

```powershell
npm run cdk:aws:bootstrap
```

Không chạy lại bước tạo hosted zone hoặc certificate nếu các stack đó đã tồn tại.
Khi deploy lại stack đang phục vụ domain thật, luôn truyền lại domain và
certificate ARN: nếu bỏ các giá trị này, CDK sẽ synth frontend/API không có
custom domain.

## Các stack tạo một lần

### Route 53 hosted zone — `SupermarketDomainHostedZoneStack`

```powershell
npm run cdk:aws:deploy:domain-hosted-zone -- `
  -c "route53HostedZoneDomainName=$domain"
```

Nếu domain mua ngoài AWS, sau khi tạo hosted zone cần trỏ nameserver tại nhà
đăng ký domain về các nameserver trong stack output.

### CloudFront certificate — `SupermarketFrontendCertificateStack`

Certificate cho frontend và assets phải ở `us-east-1`; stack này đã đặt region đó.

```powershell
npm run cdk:aws:deploy:frontend-certificate -- `
  -c "frontendCertificateDomainName=$domain" `
  -c "frontendCertificateHostedZoneDomainName=$domain" `
  -c "frontendCertificateSubjectAlternativeNames=www.$domain,assets.$domain"
```

### API certificate — `SupermarketApiCertificateStack`

Certificate của API Gateway regional nằm ở `ap-southeast-1`.

```powershell
npm run cdk:aws:deploy:api-certificate -- `
  -c "apiCertificateDomainName=api.$domain" `
  -c "apiCertificateHostedZoneDomainName=$domain"
```

## Lấy các giá trị đang dùng

Chạy sau khi certificate stacks đã tồn tại. Đọc ARN từ CloudFormation output
để tránh chép nhầm certificate của frontend và API.

```powershell
$frontendCertArn = aws cloudformation describe-stacks `
  --stack-name SupermarketFrontendCertificateStack `
  --region us-east-1 `
  --query "Stacks[0].Outputs[?OutputKey=='FrontendCertificateArn'].OutputValue | [0]" `
  --output text

$apiCertArn = aws cloudformation describe-stacks `
  --stack-name SupermarketApiCertificateStack `
  --region ap-southeast-1 `
  --query "Stacks[0].Outputs[?OutputKey=='FrontendCertificateArn'].OutputValue | [0]" `
  --output text

if ($LASTEXITCODE -ne 0 -or -not $frontendCertArn -or -not $apiCertArn -or
    $frontendCertArn -eq "None" -or $apiCertArn -eq "None") {
  throw "Khong lay duoc certificate ARN tu CloudFormation outputs."
}

# Giữ nguyên prefix Cognito đang chạy; không dùng giá trị mặc định replace-me.
$cognitoDomainPrefix = "<COGNITO_DOMAIN_PREFIX_DANG_DUNG>"
$callbackUrl = "https://$domain/auth/callback"
$logoutUrl = "https://$domain/"
$vnpayReturnUrl = "https://$domain/store/checkout/result"
$vnpayIpnUrl = "https://api.$domain/api/payments/vnpay/ipn"
```

`$cognitoDomainPrefix` phải được thay bằng prefix thực tế trước khi deploy API.
Với các CloudFormation parameter khác đã tùy biến trong stack, kiểm tra giá trị
đang dùng trước khi deploy lại; script chỉ truyền những parameter được liệt kê.

## Deploy từng stack

### API/backend — `SupermarketAwsStack`

```powershell
npm run deploy:aws -- `
  -AwsProfile $awsProfile `
  -SkipFrontendCloudFront `
  -ApiCustomDomainName "api.$domain" `
  -ApiCertificateArn $apiCertArn `
  -ApiHostedZoneDomainName $domain `
  -ProductImagesDomainNames "assets.$domain" `
  -ProductImagesCertificateArn $frontendCertArn `
  -ProductImagesHostedZoneDomainName $domain `
  -CallbackUrl $callbackUrl `
  -LogoutUrl $logoutUrl `
  -CognitoDomainPrefix $cognitoDomainPrefix `
  -VnpayReturnUrl $vnpayReturnUrl `
  -VnpayIpnUrl $vnpayIpnUrl
```

Đọc API Gateway origin từ output sau khi API stack đã tồn tại:

```powershell
$apiGatewayUrl = aws cloudformation describe-stacks `
  --stack-name SupermarketAwsStack `
  --region ap-southeast-1 `
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue | [0]" `
  --output text

if ($LASTEXITCODE -ne 0 -or -not $apiGatewayUrl -or $apiGatewayUrl -eq "None") {
  throw "Khong lay duoc ApiGatewayUrl tu SupermarketAwsStack."
}
$apiOriginDomain = ([uri]$apiGatewayUrl).Host
```

### Frontend/CloudFront — `SupermarketFrontendCloudFrontStack`

Lệnh này cũng áp dụng cấu hình chặn `US` đang nằm trong CDK. Cấu hình frontend
giữ `403` từ geo restriction, không đổi thành `200`.

```powershell
npm run deploy:aws -- `
  -AwsProfile $awsProfile `
  -FrontendCloudFrontOnly `
  -FrontendDomainNames "$domain,www.$domain" `
  -FrontendCertificateArn $frontendCertArn `
  -FrontendHostedZoneDomainName $domain `
  -FrontendApiOriginDomainName $apiOriginDomain `
  -FrontendApiOriginPath "/prod"
```

Nếu chỉ sửa danh sách quốc gia bị chặn trong CloudFront stack, dùng lại lệnh
frontend này. Không cần deploy lại API hoặc upload lại file frontend.

### S3 storage — `SupermarketS3StorageStack`

```powershell
npm run cdk:aws:deploy:s3
```

### Upload frontend static files

Đây là bước upload bản build Next.js lên S3 và invalidate CloudFront, không phải
một CloudFormation stack. Chạy khi **code frontend** thay đổi hoặc khi deploy
frontend lần đầu.

```powershell
npm run deploy:frontend:static -- -AwsProfile $awsProfile
```

## Một lệnh deploy API + frontend

Lệnh dưới đây gọi `scripts/deploy-aws.ps1`: build Lambda, deploy API trước, rồi
deploy frontend. Nó không tạo lại hosted zone, certificate, S3 storage stack và
không upload static frontend files. Cần chạy phần **Lấy các giá trị đang dùng**
ở trên; với môi trường đã có API stack, chạy thêm phần lấy `$apiOriginDomain`.

```powershell
npm run deploy:aws -- `
  -AwsProfile $awsProfile `
  -ApiCustomDomainName "api.$domain" `
  -ApiCertificateArn $apiCertArn `
  -ApiHostedZoneDomainName $domain `
  -ProductImagesDomainNames "assets.$domain" `
  -ProductImagesCertificateArn $frontendCertArn `
  -ProductImagesHostedZoneDomainName $domain `
  -FrontendDomainNames "$domain,www.$domain" `
  -FrontendCertificateArn $frontendCertArn `
  -FrontendHostedZoneDomainName $domain `
  -FrontendApiOriginDomainName $apiOriginDomain `
  -FrontendApiOriginPath "/prod" `
  -CallbackUrl $callbackUrl `
  -LogoutUrl $logoutUrl `
  -CognitoDomainPrefix $cognitoDomainPrefix `
  -VnpayReturnUrl $vnpayReturnUrl `
  -VnpayIpnUrl $vnpayIpnUrl
```

## Một lệnh deploy cả ba stack ứng dụng

Lệnh này đọc certificate ARN, API origin và các URL đang dùng từ CloudFormation,
sau đó deploy API, frontend và S3 storage theo thứ tự. Nó dừng trước khi deploy
nếu không đọc được các giá trị bắt buộc. Certificate và hosted zone phải tồn tại;
đây không phải lệnh khởi tạo môi trường mới. Lệnh không upload static frontend
files.

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile $awsProfile -DomainName $domain -CheckOnly
npm run cdk:aws:deploy:all -- -AwsProfile $awsProfile -DomainName $domain
```

Dòng `-CheckOnly` chỉ xác nhận AWS profile, certificate và tham số cần thiết;
nó không deploy.

Lệnh `:all` cũ đã được thay bằng script có bước kiểm tra này. Lệnh cũ từng
deploy CDK mà không truyền custom domain context, làm xóa Alias A/AAAA của
`truyenmasinhvien.com`, `www`, `api` và `assets`.
