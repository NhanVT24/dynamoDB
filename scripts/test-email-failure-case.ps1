[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("bus-rule-miss", "eventbridge-target-failure", "lambda-processing-failure")]
  [string]$Case,

  [string]$Region = "ap-southeast-1",
  [string]$Profile = "nhandev",

  [ValidateRange(0, 3600)]
  [int]$ArchiveIngestionWaitSeconds = 600,

  [switch]$SkipArchiveReplay
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot

Write-Host "Email failure test: $Case" -ForegroundColor Cyan

switch ($Case) {
  "bus-rule-miss" {
    $arguments = @{
      Region = $Region
      Profile = $Profile
      ArchiveIngestionWaitSeconds = $ArchiveIngestionWaitSeconds
    }
    if ($SkipArchiveReplay) { $arguments.SkipReplay = $true }
    & (Join-Path $scriptRoot "test-eventbridge-email-rule-miss-archive.ps1") @arguments
    break
  }

  "eventbridge-target-failure" {
    & (Join-Path $scriptRoot "test-eventbridge-email-delivery-dlq.ps1") `
      -Region $Region `
      -Profile $Profile
    break
  }

  "lambda-processing-failure" {
    & (Join-Path $scriptRoot "test-email-pipeline-dlq.ps1") `
      -Mode "inject-dlq" `
      -Region $Region `
      -Profile $Profile
    Write-Host "After the TEST ONLY message reaches the DLQ:" -ForegroundColor Cyan
    Write-Host "  1. Run .\scripts\test-email-pipeline-dlq.ps1 -Mode recover-test-mode -Region $Region -Profile $Profile" -ForegroundColor Cyan
    Write-Host "  2. In Email Center, select that message and click Redrive to email queue." -ForegroundColor Cyan
    Write-Host "  3. Run .\scripts\test-email-pipeline-dlq.ps1 -Mode disable-test-mode -Region $Region -Profile $Profile" -ForegroundColor Cyan
    break
  }
}

if ($LASTEXITCODE -ne 0) {
  throw "Failure-case script exited with code $LASTEXITCODE."
}
