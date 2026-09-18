[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev",
  [string]$StackName = "SupermarketFrontendCloudFrontStack",
  [string]$ApiBaseUrl = "/api/lambda-proxy"
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $workspaceRoot
$env:AWS_PROFILE = $AwsProfile
$env:NEXT_PUBLIC_API_URL = $ApiBaseUrl

Write-Host "Building static frontend with NEXT_PUBLIC_API_URL=$ApiBaseUrl"
& npm run build -w @supermarket/web
if ($LASTEXITCODE -ne 0) {
  throw "Frontend static build failed."
}

$outputsJson = & aws cloudformation describe-stacks `
  --stack-name $StackName `
  --query "Stacks[0].Outputs" `
  --output json
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read CloudFormation outputs for stack '$StackName'. Deploy the stack first."
}

$outputs = $outputsJson | ConvertFrom-Json
$bucketName = ($outputs | Where-Object { $_.OutputKey -eq "FrontendBucketName" }).OutputValue
$distributionId = ($outputs | Where-Object { $_.OutputKey -eq "FrontendDistributionId" }).OutputValue

if (-not $bucketName) {
  throw "FrontendBucketName output was not found in stack '$StackName'."
}

if (-not $distributionId) {
  throw "FrontendDistributionId output was not found in stack '$StackName'."
}

$outDir = Join-Path $workspaceRoot "apps\web\out"
if (-not (Test-Path -LiteralPath $outDir)) {
  throw "Static output directory does not exist: $outDir"
}

Write-Host "Syncing static frontend to s3://$bucketName"
& aws s3 sync $outDir "s3://$bucketName" --delete
if ($LASTEXITCODE -ne 0) {
  throw "Unable to sync frontend files to S3 bucket '$bucketName'."
}

Write-Host "Creating CloudFront invalidation for distribution $distributionId"
& aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create CloudFront invalidation for distribution '$distributionId'."
}

Write-Host "Static frontend deployment completed."
