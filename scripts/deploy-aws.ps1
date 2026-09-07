[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $workspaceRoot
$env:AWS_PROFILE = $AwsProfile

Write-Host "Deploying with AWS profile: $AwsProfile"
& aws sts get-caller-identity
if ($LASTEXITCODE -ne 0) {
  Write-Host "AWS credentials are missing or expired. Starting AWS SSO login..."
  & aws sso login --profile $AwsProfile
  if ($LASTEXITCODE -ne 0) {
    throw "AWS SSO login failed for profile '$AwsProfile'."
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

# cdk:aws:deploy already packages the Lambda once before deploying.
$deployStartedAt = Get-Date
& npm run cdk:aws:deploy
if ($LASTEXITCODE -ne 0) {
  throw "AWS CDK deployment failed."
}

$elapsed = (Get-Date) - $deployStartedAt
Write-Host ("Deployment completed in {0:mm\\:ss}." -f $elapsed)
