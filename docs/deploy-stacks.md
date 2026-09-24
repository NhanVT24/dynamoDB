# Lệnh deploy các AWS stack

## Deploy chính — dùng khi cập nhật hạ tầng đang chạy

Chạy tại thư mục gốc repo bằng PowerShell. Lệnh này deploy theo thứ tự
**API/backend → frontend CloudFront → S3 storage**, tự đọc lại certificate,
domain và các URL đang dùng từ CloudFormation. Nó dừng trước khi deploy nếu
thiếu dữ liệu bắt buộc.

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile nhandev -DomainName truyenmasinhvien.com
```

Kiểm tra đầu vào mà **không deploy**:

```powershell
npm run cdk:aws:deploy:all -- -AwsProfile nhandev -DomainName truyenmasinhvien.com -CheckOnly
```

Lệnh chính cần hosted zone, certificate và API stack đã tồn tại. Nó không
upload file frontend; khi code Next.js thay đổi, chạy thêm
`npm run deploy:frontend:static -- -AwsProfile nhandev`.

| Nhu cầu | Xem mục |
| --- | --- |
| Deploy toàn bộ ba stack ứng dụng | Lệnh **Deploy chính** ngay trên |
| Chỉ cập nhật API/backend | [Deploy từng stack](#deploy-từng-stack) |
| Chỉ cập nhật frontend/geo restriction | [Frontend/CloudFront](#frontendcloudfront--supermarketfrontendcloudfrontstack) |
| Chỉ cập nhật S3 storage | [S3 storage](#s3-storage--supermarkets3storagestack) |

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
