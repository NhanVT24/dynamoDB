[CmdletBinding()]
param(
  [string]$AwsProfile = "nhandev"
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

# cdk:aws:deploy already packages the Lambda once before deploying.
& npm run cdk:aws:deploy
if ($LASTEXITCODE -ne 0) {
  throw "AWS CDK deployment failed."
}
