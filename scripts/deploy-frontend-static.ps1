[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev",
  [string]$StackName = "SupermarketFrontendCloudFrontStack",
  [string]$ApiBaseUrl = "/api/lambda-proxy",
  [string]$AwsRegion = "ap-southeast-1",
  [string]$CognitoUserPoolId,
  [string]$CognitoClientId,
  [string]$CognitoDomain
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $workspaceRoot
$env:AWS_PROFILE = $AwsProfile
$env:NEXT_PUBLIC_API_URL = $ApiBaseUrl
$env:NEXT_PUBLIC_AWS_REGION = $AwsRegion

if ($CognitoUserPoolId) {
  $env:NEXT_PUBLIC_COGNITO_USER_POOL_ID = $CognitoUserPoolId
}

if ($CognitoClientId) {
  $env:NEXT_PUBLIC_COGNITO_CLIENT_ID = $CognitoClientId
}

if ($CognitoDomain) {
  $env:NEXT_PUBLIC_COGNITO_DOMAIN = $CognitoDomain
}

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

$staticCacheControl = "public,max-age=31536000,immutable"
$documentCacheControl = "no-cache,no-store,must-revalidate"

Write-Host "Syncing immutable Next.js assets to s3://$bucketName/_next/static"
& aws s3 sync (Join-Path $outDir "_next\static") "s3://$bucketName/_next/static" `
  --cache-control $staticCacheControl
if ($LASTEXITCODE -ne 0) {
  throw "Unable to sync immutable frontend assets to S3 bucket '$bucketName'."
}

Write-Host "Ensuring retained static assets have immutable cache metadata"
$staticObjectKeysJson = & aws s3api list-objects-v2 `
  --bucket $bucketName `
  --prefix "_next/static/" `
  --query "Contents[].Key" `
  --output json
if ($LASTEXITCODE -ne 0) {
  throw "Unable to list retained static assets in S3 bucket '$bucketName'."
}

$staticObjectKeys = $staticObjectKeysJson | ConvertFrom-Json
foreach ($objectKey in $staticObjectKeys) {
  $objectHeadJson = & aws s3api head-object `
    --bucket $bucketName `
    --key $objectKey `
    --query "{CacheControl:CacheControl,ContentType:ContentType,ContentEncoding:ContentEncoding}" `
    --output json
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read metadata for retained static asset '$objectKey'."
  }

  $objectHead = $objectHeadJson | ConvertFrom-Json
  if ($objectHead.CacheControl -eq $staticCacheControl) {
    continue
  }

  $copyArgs = @(
    "s3api",
    "copy-object",
    "--bucket",
    $bucketName,
    "--key",
    $objectKey,
    "--copy-source",
    "$bucketName/$objectKey",
    "--metadata-directive",
    "REPLACE",
    "--cache-control",
    $staticCacheControl
  )

  if ($objectHead.ContentType) {
    $copyArgs += @("--content-type", $objectHead.ContentType)
  }

  if ($objectHead.ContentEncoding) {
    $copyArgs += @("--content-encoding", $objectHead.ContentEncoding)
  }

  & aws @copyArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to update cache metadata for retained static asset '$objectKey'."
  }
}

Write-Host "Syncing revalidated frontend documents to s3://$bucketName"
& aws s3 sync $outDir "s3://$bucketName" `
  --exclude "_next/static/*" `
  --cache-control $documentCacheControl `
  --delete
if ($LASTEXITCODE -ne 0) {
  throw "Unable to sync frontend documents to S3 bucket '$bucketName'."
}

Write-Host "Creating CloudFront invalidation for distribution $distributionId"
& aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create CloudFront invalidation for distribution '$distributionId'."
}

Write-Host "Static frontend deployment completed."
