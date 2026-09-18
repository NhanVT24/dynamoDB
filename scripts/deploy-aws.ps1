[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev",
  [switch]$Clean,
  [switch]$FrontendCloudFrontOnly,
  [switch]$SkipFrontendCloudFront,
  [string]$FrontendApiOriginDomainName,
  [string]$FrontendApiOriginPath = "/prod",
  [string]$FrontendCertificateArn,
  [string]$FrontendDomainNames
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $workspaceRoot
$env:AWS_PROFILE = $AwsProfile

if ($FrontendCloudFrontOnly -and $SkipFrontendCloudFront) {
  throw "Use either -FrontendCloudFrontOnly or -SkipFrontendCloudFront, not both."
}

if ($FrontendApiOriginDomainName) {
  $env:FRONTEND_API_ORIGIN_DOMAIN_NAME = $FrontendApiOriginDomainName
  $env:FRONTEND_API_ORIGIN_PATH = $FrontendApiOriginPath
}

if ($FrontendCertificateArn) {
  $env:FRONTEND_CERTIFICATE_ARN = $FrontendCertificateArn
}

if ($FrontendDomainNames) {
  $env:FRONTEND_DOMAIN_NAMES = $FrontendDomainNames
}

Write-Host "Deploying with AWS profile: $AwsProfile"
& aws sts get-caller-identity
if ($LASTEXITCODE -ne 0) {
  Write-Host "AWS credentials are missing or expired. Starting AWS login..."
  & aws login --profile $AwsProfile
  if ($LASTEXITCODE -ne 0) {
    throw "AWS login failed for profile '$AwsProfile'."
  }

  & aws sts get-caller-identity
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify AWS credentials for profile '$AwsProfile' after SSO login."
  }
}

if ($Clean) {
  # A clean build is useful when a package is suspected to be corrupt, but it
  # deliberately invalidates the Lambda zip cache and can make deployment much
  # slower. Normal deployments should reuse the content-addressed package.
  $cleanTargets = @(
    (Join-Path $workspaceRoot "cdk.out"),
    (Join-Path $workspaceRoot "apps\api\dist")
  )

  foreach ($target in $cleanTargets) {
    $absoluteTarget = [System.IO.Path]::GetFullPath($target)
    if (-not $absoluteTarget.StartsWith("$workspaceRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a path outside the workspace: $absoluteTarget"
    }

    if (Test-Path -LiteralPath $absoluteTarget) {
      Write-Host "Removing build artifact: $absoluteTarget"
      Remove-Item -LiteralPath $absoluteTarget -Recurse -Force
    }
  }
} else {
  Write-Host "Reusing CDK and Lambda build artifacts. Use -Clean only for a forced rebuild."
}

$deployStartedAt = Get-Date

if (-not $FrontendCloudFrontOnly) {
  # cdk:aws:deploy already packages the Lambda once before deploying.
  & npm run cdk:aws:deploy
  if ($LASTEXITCODE -ne 0) {
    throw "AWS API CDK deployment failed."
  }
}

if (-not $SkipFrontendCloudFront) {
  $frontendDeployArgs = @("run", "cdk:aws:deploy:frontend")
  if ($FrontendApiOriginDomainName -or $FrontendCertificateArn -or $FrontendDomainNames) {
    $frontendDeployArgs += "--"
    if ($FrontendApiOriginDomainName) {
      $frontendDeployArgs += @("-c", "frontendApiOriginDomainName=$FrontendApiOriginDomainName")
      $frontendDeployArgs += @("-c", "frontendApiOriginPath=$FrontendApiOriginPath")
    }
    if ($FrontendCertificateArn) {
      $frontendDeployArgs += @("-c", "frontendCertificateArn=$FrontendCertificateArn")
    }
    if ($FrontendDomainNames) {
      $frontendDeployArgs += @("-c", "frontendDomainNames=$FrontendDomainNames")
    }
  }

  & npm @frontendDeployArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend CloudFront CDK deployment failed."
  }
}

$elapsed = (Get-Date) - $deployStartedAt
Write-Host ("Deployment completed in {0}." -f $elapsed.ToString("mm\:ss"))
