param(
  [string]$Region = "ap-southeast-1",
  [string]$Profile = "nhandev",
  [string]$EventBusName = "supermarket-platform-bus",
  [string]$RuleName = "supermarket-email-eventbridge-failure-test-rule",
  [string]$RecoveryRuleName = "supermarket-email-eventbridge-success-test-rule",
  [string]$DlqName = "supermarket-email-eventbridge-delivery-dlq"
)

$ErrorActionPreference = "Stop"

function Invoke-AwsCli {
  param([string[]]$Arguments)
  $awsArguments = @()
  if ($Profile) { $awsArguments += "--profile", $Profile }
  $awsArguments += "--region", $Region
  $awsArguments += $Arguments
  $result = & aws @awsArguments
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed (exit $LASTEXITCODE): aws $($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ')" }
  return $result
}

function Assert-AwsCredentials {
  $identityArguments = @()
  if ($Profile) { $identityArguments += "--profile", $Profile }
  $identityArguments += "--region", $Region, "sts", "get-caller-identity", "--output", "json"
  $identityJson = & aws @identityArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "AWS credentials for profile '$Profile' are invalid or expired. Run: aws login --profile $Profile"
  }
  $identity = $identityJson | ConvertFrom-Json
  Write-Host "AWS identity: $($identity.Arn)" -ForegroundColor DarkGray
}

$ruleEnabledByScript = $false
Write-Host "[1/8] Validating AWS credentials (profile=$Profile, region=$Region)..." -ForegroundColor Cyan
Assert-AwsCredentials
$payloadFile = New-TemporaryFile
try {
  $testId = [guid]::NewGuid().ToString()
  $entry = @{
    Entries = @(@{
      EventBusName = $EventBusName
      Source = "supermarket.email.test"
      DetailType = "email.eventbridge.delivery-failure.test"
      Detail = (@{ testCase = "eventbridge-target-delivery-dlq"; testId = $testId } | ConvertTo-Json -Compress)
    })
  } | ConvertTo-Json -Compress -Depth 5
  [System.IO.File]::WriteAllText($payloadFile.FullName, $entry, [System.Text.UTF8Encoding]::new($false))

  $dlqUrl = (Invoke-AwsCli @("sqs", "get-queue-url", "--queue-name", $DlqName, "--output", "json") | ConvertFrom-Json).QueueUrl
  $before = Invoke-AwsCli @("sqs", "get-queue-attributes", "--queue-url", $dlqUrl, "--attribute-names", "ApproximateNumberOfMessages", "--output", "json") | ConvertFrom-Json
  $beforeCount = [int]$before.Attributes.ApproximateNumberOfMessages
  Write-Host "[2/8] Delivery DLQ baseline: $beforeCount visible message(s). TestId=$testId" -ForegroundColor Cyan

  # Ensure only the intentionally failing route matches the first publish.
  Write-Host "[3/8] Disabling recovery rule and enabling the intentionally failing rule..." -ForegroundColor Cyan
  Invoke-AwsCli @("events", "disable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  Invoke-AwsCli @("events", "enable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null
  $ruleEnabledByScript = $true
  Write-Host "[4/8] Publishing the test event to $EventBusName..." -ForegroundColor Cyan
  $putResult = Invoke-AwsCli @("events", "put-events", "--cli-input-json", "file://$($payloadFile.FullName)", "--output", "json") | ConvertFrom-Json
  if ([int]$putResult.FailedEntryCount -ne 0) { throw "PutEvents rejected the test event: $($putResult.Entries[0].ErrorMessage)" }
  Write-Host "      Event accepted by Bus. EventId=$($putResult.Entries[0].EventId)" -ForegroundColor DarkGray
  Write-Host "[5/8] EventBridge is attempting the denied SQS target; waiting for delivery DLQ..." -ForegroundColor Yellow
  $currentCount = $beforeCount
  for ($attempt = 1; $attempt -le 6 -and $currentCount -le $beforeCount; $attempt++) {
    Start-Sleep -Seconds 5
    $attributes = Invoke-AwsCli @("sqs", "get-queue-attributes", "--queue-url", $dlqUrl, "--attribute-names", "ApproximateNumberOfMessages", "--output", "json") | ConvertFrom-Json
    $currentCount = [int]$attributes.Attributes.ApproximateNumberOfMessages
    Write-Host "      Poll $attempt/6: $currentCount visible message(s)" -ForegroundColor DarkGray
  }
  if ($currentCount -le $beforeCount) { throw "No new delivery-DLQ message appeared within 30 seconds." }
  Write-Host "[6/8] Delivery failure captured in $DlqName." -ForegroundColor Green
  Write-Host "[7/8] Disabling failure rule and enabling recovery route..." -ForegroundColor Cyan
  Invoke-AwsCli @("events", "disable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null
  $ruleEnabledByScript = $false
  Invoke-AwsCli @("events", "enable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  Write-Host "[8/8] Ready: open Email Center > Queue recovery > Refresh > Replay to EventBus." -ForegroundColor Green
  Write-Host "      The replayed event will reach supermarket-email-eventbridge-success-test-target. TestId=$testId" -ForegroundColor Green
}
finally {
  Remove-Item -LiteralPath $payloadFile.FullName -Force -ErrorAction SilentlyContinue
  if ($ruleEnabledByScript) {
    try { Invoke-AwsCli @("events", "disable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null } catch { Write-Warning "Could not disable test rule. Disable it manually: $RuleName" }
  }
}
