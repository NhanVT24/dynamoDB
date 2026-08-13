param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$ApiBaseUrl = "http://localhost:4000",

  [ValidateSet("payment-success", "payment-failed", "payment-dlq", "payment-failed-dlq")]
  [string]$Scenario = "payment-success"
)

$ErrorActionPreference = "Stop"

$uri = "$ApiBaseUrl/api/notifications/test/$Scenario"
$headers = @{
  Authorization = "Bearer $Token"
}

Write-Host "Sending 2 concurrent requests to $uri" -ForegroundColor Cyan

$jobs = @(
  Start-Job -Name "queue-msg-1" -ScriptBlock {
    param($targetUri, $targetHeaders)
    Invoke-RestMethod -Method Post -Uri $targetUri -Headers $targetHeaders
  } -ArgumentList $uri, $headers

  Start-Job -Name "queue-msg-2" -ScriptBlock {
    param($targetUri, $targetHeaders)
    Invoke-RestMethod -Method Post -Uri $targetUri -Headers $targetHeaders
  } -ArgumentList $uri, $headers
)

try {
  Wait-Job -Job $jobs | Out-Null

  $results = $jobs | ForEach-Object {
    $output = Receive-Job -Job $_
    [PSCustomObject]@{
      JobName = $_.Name
      Result = $output
    }
  }

  $results | Format-List
}
finally {
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
}
