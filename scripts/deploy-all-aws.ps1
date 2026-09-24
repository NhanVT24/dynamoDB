[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev",
  [string]$DomainName = "truyenmasinhvien.com",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $workspaceRoot
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = "ap-southeast-1"

if ([string]::IsNullOrWhiteSpace($DomainName)) {
  throw "DomainName must not be empty."
}

& aws sts get-caller-identity --profile $AwsProfile --query Account --output text | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "AWS profile '$AwsProfile' is not authenticated."
}

function Get-StackOutput {
  param(
    [string]$StackName,
    [string]$Region,
    [string]$OutputKey
  )

  $value = & aws cloudformation describe-stacks `
    --profile $AwsProfile `
    --region $Region `
    --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='$OutputKey'].OutputValue | [0]" `
    --output text
  if ($LASTEXITCODE -ne 0 -or -not $value -or $value -eq "None") {
    throw "Missing output '$OutputKey' in stack '$StackName' ($Region)."
  }
  return $value.Trim()
}

function Get-StackParameter {
  param(
    [string]$StackName,
    [string]$Region,
    [string]$ParameterKey
  )

  $value = & aws cloudformation describe-stacks `
    --profile $AwsProfile `
    --region $Region `
    --stack-name $StackName `
    --query "Stacks[0].Parameters[?ParameterKey=='$ParameterKey'].ParameterValue | [0]" `
    --output text
  if ($LASTEXITCODE -ne 0 -or -not $value -or $value -eq "None" -or $value -eq "****") {
    throw "Missing readable parameter '$ParameterKey' in stack '$StackName' ($Region)."
  }
  return $value.Trim()
}

$frontendCertificateArn = Get-StackOutput `
  -StackName "SupermarketFrontendCertificateStack" `
  -Region "us-east-1" `
  -OutputKey "FrontendCertificateArn"
$apiCertificateArn = Get-StackOutput `
  -StackName "SupermarketApiCertificateStack" `
  -Region "ap-southeast-1" `
  -OutputKey "FrontendCertificateArn"
$apiGatewayUrl = Get-StackOutput `
  -StackName "SupermarketAwsStack" `
  -Region "ap-southeast-1" `
  -OutputKey "ApiGatewayUrl"
$apiGatewayUri = [uri]$apiGatewayUrl
$apiOriginDomainName = $apiGatewayUri.Host
$apiOriginPath = $apiGatewayUri.AbsolutePath.TrimEnd("/")

$callbackUrl = Get-StackParameter -StackName "SupermarketAwsStack" -Region "ap-southeast-1" -ParameterKey "CallbackUrl"
$logoutUrl = Get-StackParameter -StackName "SupermarketAwsStack" -Region "ap-southeast-1" -ParameterKey "LogoutUrl"
$cognitoDomainPrefix = Get-StackParameter -StackName "SupermarketAwsStack" -Region "ap-southeast-1" -ParameterKey "CognitoDomainPrefix"
$vnpayReturnUrl = Get-StackParameter -StackName "SupermarketAwsStack" -Region "ap-southeast-1" -ParameterKey "VnpayReturnUrl"
$vnpayIpnUrl = Get-StackParameter -StackName "SupermarketAwsStack" -Region "ap-southeast-1" -ParameterKey "VnpayIpnUrl"

if ($CheckOnly) {
  Write-Host "Preflight passed for $DomainName (API origin: $apiOriginDomainName$apiOriginPath). No stack was deployed."
  return
}

Write-Host "Deploying API and frontend with custom domains for $DomainName."
& powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -AwsProfile $AwsProfile `
  -ApiCertificateArn $apiCertificateArn `
  -ApiCustomDomainName "api.$DomainName" `
  -ApiHostedZoneDomainName $DomainName `
  -ProductImagesCertificateArn $frontendCertificateArn `
  -ProductImagesDomainNames "assets.$DomainName" `
  -ProductImagesHostedZoneDomainName $DomainName `
  -FrontendCertificateArn $frontendCertificateArn `
  -FrontendDomainNames "$DomainName,www.$DomainName" `
  -FrontendHostedZoneDomainName $DomainName `
  -FrontendApiOriginDomainName $apiOriginDomainName `
  -FrontendApiOriginPath $apiOriginPath `
  -CallbackUrl $callbackUrl `
  -LogoutUrl $logoutUrl `
  -CognitoDomainPrefix $cognitoDomainPrefix `
  -StorefrontPublicUrl "https://$DomainName" `
  -VnpayReturnUrl $vnpayReturnUrl `
  -VnpayIpnUrl $vnpayIpnUrl
if ($LASTEXITCODE -ne 0) {
  throw "API/frontend deployment failed; S3 storage stack was not deployed."
}

Write-Host "Deploying S3 storage stack."
& npm run cdk:aws:deploy:s3
if ($LASTEXITCODE -ne 0) {
  throw "S3 storage stack deployment failed."
}
