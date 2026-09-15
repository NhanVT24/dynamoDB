[CmdletBinding()]
param(
  [string]$Region = "ap-southeast-1",
  [string]$Profile = "nhandev",
  [string]$StackName = "SupermarketAwsStack",
  [string]$EventBusName = "supermarket-platform-bus",
  [string]$ArchiveName = "supermarket-platform-archive",
  [string]$RecoveryRuleName = "supermarket-email-eventbridge-success-test-rule",
  [string]$RecoveryQueueName = "supermarket-email-eventbridge-success-test-target",
  [ValidateRange(0, 3600)]
  [int]$ArchiveIngestionWaitSeconds = 600,
  [ValidateRange(60, 3600)]
  [int]$ReplayTimeoutSeconds = 900,
  [ValidateRange(60, 900)]
  [int]$WatchdogTimeoutSeconds = 420,
  [switch]$SkipReplay
)

$ErrorActionPreference = "Stop"

# AWS CLI on Windows can inherit a legacy console code page. Commands such as
# describe-archive then fail while printing a Vietnamese Description even
# though the AWS request itself succeeded.
$previousPythonUtf8 = $env:PYTHONUTF8
$previousPythonIoEncoding = $env:PYTHONIOENCODING
$previousAwsCliFileEncoding = $env:AWS_CLI_FILE_ENCODING
$previousConsoleOutputEncoding = [Console]::OutputEncoding
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "UTF-8"
$env:AWS_CLI_FILE_ENCODING = "UTF-8"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Invoke-AwsCli {
  param([string[]]$Arguments)

  $awsArguments = @()
  if ($Profile) { $awsArguments += "--profile", $Profile }
  $awsArguments += "--region", $Region
  $awsArguments += $Arguments
  $result = & aws @awsArguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI failed (exit $LASTEXITCODE): aws $($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ')"
  }
  return $result
}

function Assert-AwsCredentials {
  $arguments = @()
  if ($Profile) { $arguments += "--profile", $Profile }
  $arguments += "--region", $Region, "sts", "get-caller-identity", "--output", "json"
  $identityJson = & aws @arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "AWS credentials for profile '$Profile' are invalid or expired. Refresh the profile, then rerun the script."
  }
  $identity = $identityJson | ConvertFrom-Json
  Write-Host "      AWS identity: $($identity.Arn)" -ForegroundColor DarkGray
}

function Write-Utf8JsonFile {
  param([object]$Value)

  $file = New-TemporaryFile
  $json = $Value | ConvertTo-Json -Compress -Depth 10
  [System.IO.File]::WriteAllText($file.FullName, $json, [System.Text.UTF8Encoding]::new($false))
  return $file
}

function Receive-TestMessage {
  param(
    [string]$QueueUrl,
    [string]$ExpectedTestId,
    [int]$WaitTimeSeconds = 0
  )

  $response = Invoke-AwsCli @(
    "sqs", "receive-message",
    "--queue-url", $QueueUrl,
    "--max-number-of-messages", "10",
    "--visibility-timeout", "30",
    "--wait-time-seconds", ([string][Math]::Min(20, [Math]::Max(0, $WaitTimeSeconds))),
    "--attribute-names", "All",
    "--message-attribute-names", "All",
    "--output", "json"
  ) | ConvertFrom-Json

  $matched = $null
  foreach ($message in @($response.Messages)) {
    $isMatch = $false
    try {
      $body = $message.Body | ConvertFrom-Json
      $isMatch = $body.detail.testId -eq $ExpectedTestId
    }
    catch {
      $isMatch = $false
    }

    if ($isMatch -and -not $matched) {
      $matched = $message
      continue
    }

    # Never keep an unrelated message hidden in the shared test queue.
    Invoke-AwsCli @(
      "sqs", "change-message-visibility",
      "--queue-url", $QueueUrl,
      "--receipt-handle", $message.ReceiptHandle,
      "--visibility-timeout", "0"
    ) | Out-Null
  }
  return $matched
}

function Wait-WithProgress {
  param([int]$Seconds)

  if ($Seconds -le 0) { return }
  $remaining = $Seconds
  while ($remaining -gt 0) {
    $slice = [Math]::Min(30, $remaining)
    Write-Host "      Waiting for archive ingestion: $remaining second(s) remaining..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $slice
    $remaining -= $slice
  }
}

function Get-RouteRecord {
  param([string]$TableName, [string]$KeyFile)

  $response = Invoke-AwsCli @(
    "dynamodb", "get-item",
    "--table-name", $TableName,
    "--key", "file://$KeyFile",
    "--consistent-read",
    "--output", "json"
  ) | ConvertFrom-Json
  return $response.Item
}

$originalRuleState = $null
$payloadFile = $null
$destinationFile = $null
$routeKeyFile = $null
$routeRecordFile = $null
$routePublishFile = $null

Write-Host "[1/12] Validating AWS credentials..." -ForegroundColor Cyan
Assert-AwsCredentials

try {
  Write-Host "[2/12] Resolving EventBridge, DynamoDB, and SQS test resources..." -ForegroundColor Cyan
  $bus = Invoke-AwsCli @("events", "describe-event-bus", "--name", $EventBusName, "--output", "json") | ConvertFrom-Json
  # Exclude Description from CLI output as an additional safeguard for old
  # AWS CLI/Python builds that ignore the UTF-8 environment variables.
  $archive = Invoke-AwsCli @(
    "events", "describe-archive",
    "--archive-name", $ArchiveName,
    "--query", "{ArchiveArn:ArchiveArn,State:State,EventSourceArn:EventSourceArn,RetentionDays:RetentionDays}",
    "--output", "json"
  ) | ConvertFrom-Json
  $rule = Invoke-AwsCli @("events", "describe-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName, "--output", "json") | ConvertFrom-Json
  $recoveryTargets = Invoke-AwsCli @("events", "list-targets-by-rule", "--rule", $RecoveryRuleName, "--event-bus-name", $EventBusName, "--output", "json") | ConvertFrom-Json
  $queueUrl = (Invoke-AwsCli @("sqs", "get-queue-url", "--queue-name", $RecoveryQueueName, "--output", "json") | ConvertFrom-Json).QueueUrl
  $tableName = Invoke-AwsCli @(
    "cloudformation", "describe-stacks",
    "--stack-name", $StackName,
    "--query", "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue | [0]",
    "--output", "text"
  )
  $originalRuleState = [string]$rule.State

  if (-not $bus.Arn -or -not $archive.ArchiveArn -or -not $rule.Arn -or -not $queueUrl -or -not $tableName -or $tableName -eq "None") {
    throw "One or more test resources could not be resolved. Deploy the latest CDK stack first."
  }
  if (-not ($recoveryTargets.Targets | Where-Object { $_.Arn -like "arn:aws:lambda:*" })) {
    throw "The recovery Rule has no tracker Lambda target. Deploy the latest CDK stack before running this test."
  }
  Write-Host "      Bus: $($bus.Arn)" -ForegroundColor DarkGray
  Write-Host "      Archive: $($archive.ArchiveArn) (state=$($archive.State), retention=$($archive.RetentionDays)d)" -ForegroundColor DarkGray
  Write-Host "      Recovery rule: $($rule.Arn) (original state: $originalRuleState)" -ForegroundColor DarkGray
  Write-Host "      Tracking table: $tableName" -ForegroundColor DarkGray

  if ($archive.State -ne "ENABLED") {
    throw "Archive $ArchiveName is not enabled (state=$($archive.State))."
  }

  Write-Host "[3/12] Disabling the recovery Rule before publishing..." -ForegroundColor Cyan
  Invoke-AwsCli @("events", "disable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  $disabledRule = Invoke-AwsCli @("events", "describe-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName, "--query", "State", "--output", "text")
  Write-Host "      Rule state after disable: $disabledRule" -ForegroundColor DarkGray

  $testId = [guid]::NewGuid().ToString("N")
  $emailJobId = $testId + [guid]::NewGuid().ToString("N")
  $campaignId = "rule-miss-test-$testId"
  $publishedAt = (Get-Date).ToUniversalTime()
  $routeKey = @{
    PK = @{ S = "EMAIL_ROUTE#$emailJobId" }
    SK = @{ S = "STATUS" }
  }
  $routeKeyFile = Write-Utf8JsonFile $routeKey
  $routeRecordFile = Write-Utf8JsonFile @{
    TableName = $tableName
    Item = @{
      PK = $routeKey.PK
      SK = $routeKey.SK
      entityType = @{ S = "EMAIL_ROUTE" }
      emailJobId = @{ S = $emailJobId }
      campaignId = @{ S = $campaignId }
      batchIndex = @{ N = "0" }
      batchCount = @{ N = "1" }
      status = @{ S = "PUBLISHING" }
      routeStage = @{ N = "10" }
      createdAt = @{ S = $publishedAt.ToString("o") }
      updatedAt = @{ S = $publishedAt.ToString("o") }
    }
    ConditionExpression = "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }

  Write-Host "[4/12] Creating tracking record: PUBLISHING (stage 10)..." -ForegroundColor Cyan
  Invoke-AwsCli @("dynamodb", "put-item", "--cli-input-json", "file://$($routeRecordFile.FullName)") | Out-Null
  Write-Host "      emailJobId=$emailJobId" -ForegroundColor DarkGray

  $payloadFile = Write-Utf8JsonFile @{
    Entries = @(@{
      EventBusName = $EventBusName
      Source = "supermarket.email.test"
      DetailType = "email.eventbridge.delivery-success.test"
      Detail = (@{
        testCase = "eventbridge-rule-miss-archive-replay"
        testId = $testId
        type = "email.eventbridge.delivery-success.test"
        campaignId = $campaignId
        emailJobId = $emailJobId
        batchIndex = 0
        batchCount = 1
        requestedAt = $publishedAt.ToString("o")
      } | ConvertTo-Json -Compress)
    })
  }

  Write-Host "[5/12] Publishing while the Rule is disabled. TestId=$testId" -ForegroundColor Cyan
  $putResult = Invoke-AwsCli @("events", "put-events", "--cli-input-json", "file://$($payloadFile.FullName)", "--output", "json") | ConvertFrom-Json
  if ([int]$putResult.FailedEntryCount -ne 0) {
    throw "PutEvents rejected the test event: $($putResult.Entries[0].ErrorMessage)"
  }
  $eventId = [string]$putResult.Entries[0].EventId
  Write-Host "      Bus accepted EventId=$eventId. No target invocation is expected." -ForegroundColor Green

  $publishedTimestamp = (Get-Date).ToUniversalTime().ToString("o")
  $routePublishFile = Write-Utf8JsonFile @{
    TableName = $tableName
    Key = $routeKey
    UpdateExpression = "SET #status = :status, routeStage = :stage, eventId = :eventId, publishedAt = :publishedAt, updatedAt = :publishedAt"
    ConditionExpression = "attribute_exists(PK) AND routeStage < :stage"
    ExpressionAttributeNames = @{ "#status" = "status" }
    ExpressionAttributeValues = @{
      ":status" = @{ S = "PUBLISHED" }
      ":stage" = @{ N = "20" }
      ":eventId" = @{ S = $eventId }
      ":publishedAt" = @{ S = $publishedTimestamp }
    }
  }
  Invoke-AwsCli @("dynamodb", "update-item", "--cli-input-json", "file://$($routePublishFile.FullName)") | Out-Null
  Write-Host "      Tracking transition: PUBLISHING -> PUBLISHED (stage 20)." -ForegroundColor Green

  Write-Host "[6/12] Proving the disabled Rule did not deliver this event..." -ForegroundColor Cyan
  Start-Sleep -Seconds 10
  $unexpected = Receive-TestMessage -QueueUrl $queueUrl -ExpectedTestId $testId
  if ($unexpected) {
    Invoke-AwsCli @("sqs", "delete-message", "--queue-url", $queueUrl, "--receipt-handle", $unexpected.ReceiptHandle) | Out-Null
    throw "The test event reached the queue even though the recovery rule was expected to be disabled."
  }
  Write-Host "      Confirmed: no matching message reached $RecoveryQueueName." -ForegroundColor Green

  Write-Host "[7/12] Waiting for Watchdog to detect stale PUBLISHED record..." -ForegroundColor Cyan
  $watchdogStartedAt = Get-Date
  $watchdogDeadline = $watchdogStartedAt.AddSeconds($WatchdogTimeoutSeconds)
  $route = Get-RouteRecord -TableName $tableName -KeyFile $routeKeyFile.FullName
  do {
    Write-Host "      status=$($route.status.S), stage=$($route.routeStage.N), elapsed=$([int]((Get-Date) - $watchdogStartedAt).TotalSeconds)s" -ForegroundColor DarkGray
    if ($route.status.S -eq "ROUTING_SUSPECTED") { break }
    Start-Sleep -Seconds 15
    $route = Get-RouteRecord -TableName $tableName -KeyFile $routeKeyFile.FullName
  } while ((Get-Date) -lt $watchdogDeadline)
  if ($route.status.S -ne "ROUTING_SUSPECTED") {
    throw "Watchdog did not move the route to ROUTING_SUSPECTED within $WatchdogTimeoutSeconds seconds. Check scheduler/watchdog logs."
  }
  Write-Host "      Watchdog confirmed TH2: ROUTING_SUSPECTED, alertStatus=$($route.alertStatus.S)." -ForegroundColor Green

  if ($SkipReplay) {
    Write-Host "[8/12] SkipReplay selected. The event remains recoverable from $ArchiveName." -ForegroundColor Yellow
    Write-Host "      Replay window: $($publishedAt.AddSeconds(-5).ToString('o')) to $($publishedAt.AddSeconds(5).ToString('o'))" -ForegroundColor Yellow
    return
  }

  Write-Host "[8/12] Waiting for the asynchronously populated EventBridge archive..." -ForegroundColor Cyan
  if ($ArchiveIngestionWaitSeconds -lt 600) {
    Write-Warning "AWS recommends waiting 10 minutes before archive replay; $ArchiveIngestionWaitSeconds seconds may be too short."
  }
  $alreadyWaited = [int]((Get-Date) - $watchdogStartedAt).TotalSeconds
  Wait-WithProgress -Seconds ([Math]::Max(0, $ArchiveIngestionWaitSeconds - $alreadyWaited))

  Write-Host "[9/12] Enabling the repaired/recovery Rule..." -ForegroundColor Cyan
  Invoke-AwsCli @("events", "enable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  $enabledRule = Invoke-AwsCli @("events", "describe-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName, "--query", "State", "--output", "text")
  Write-Host "      Rule state before replay: $enabledRule" -ForegroundColor DarkGray

  $replayName = "email-rule-miss-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))-$($testId.Substring(0, 8))"
  $destinationFile = Write-Utf8JsonFile @{
    Arn = [string]$bus.Arn
    FilterArns = @([string]$rule.Arn)
  }

  Write-Host "[10/12] Starting Archive Replay '$replayName' to the source bus and only the test Rule..." -ForegroundColor Cyan
  $replay = Invoke-AwsCli @(
    "events", "start-replay",
    "--replay-name", $replayName,
    "--event-source-arn", ([string]$archive.ArchiveArn),
    "--event-start-time", $publishedAt.AddSeconds(-5).ToString("o"),
    "--event-end-time", $publishedAt.AddSeconds(5).ToString("o"),
    "--destination", "file://$($destinationFile.FullName)",
    "--description", "TEST ONLY: recover a rule-missed email event",
    "--output", "json"
  ) | ConvertFrom-Json
  Write-Host "      ReplayArn=$($replay.ReplayArn), initial state=$($replay.State)" -ForegroundColor DarkGray

  Write-Host "[11/12] Waiting for Archive Replay completion..." -ForegroundColor Cyan
  $deadline = (Get-Date).AddSeconds($ReplayTimeoutSeconds)
  do {
    Start-Sleep -Seconds 10
    $status = Invoke-AwsCli @("events", "describe-replay", "--replay-name", $replayName, "--output", "json") | ConvertFrom-Json
    Write-Host "      Replay state=$($status.State), last replayed=$($status.EventLastReplayedTime)" -ForegroundColor DarkGray
    if ($status.State -in @("FAILED", "CANCELLED")) {
      throw "Archive Replay ended in state $($status.State): $($status.StateReason)"
    }
  } while ($status.State -ne "COMPLETED" -and (Get-Date) -lt $deadline)
  if ($status.State -ne "COMPLETED") { throw "Archive Replay did not complete within $ReplayTimeoutSeconds seconds." }

  Write-Host "[12/12] Verifying replay delivery and tracking recovery..." -ForegroundColor Cyan
  $matched = $null
  for ($attempt = 1; $attempt -le 12 -and -not $matched; $attempt++) {
    $matched = Receive-TestMessage -QueueUrl $queueUrl -ExpectedTestId $testId -WaitTimeSeconds 10
    Write-Host "      Queue poll $attempt/12: $(if ($matched) { 'matched' } else { 'not found yet' })" -ForegroundColor DarkGray
  }
  if (-not $matched) { throw "Replay completed, but TestId=$testId did not reach $RecoveryQueueName." }

  $replayedEnvelope = $matched.Body | ConvertFrom-Json
  Write-Host "      Replayed event received by SQS:" -ForegroundColor Green
  Write-Host "        replay-name = $($replayedEnvelope.'replay-name')" -ForegroundColor DarkGray
  Write-Host "        id          = $($replayedEnvelope.id)" -ForegroundColor DarkGray
  Write-Host "        source      = $($replayedEnvelope.source)" -ForegroundColor DarkGray
  Write-Host "        detail-type = $($replayedEnvelope.'detail-type')" -ForegroundColor DarkGray
  Write-Host "        testId      = $($replayedEnvelope.detail.testId)" -ForegroundColor DarkGray

  $routeMatched = $false
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    $route = Get-RouteRecord -TableName $tableName -KeyFile $routeKeyFile.FullName
    Write-Host "      Tracking poll $attempt/12: status=$($route.status.S), stage=$($route.routeStage.N)" -ForegroundColor DarkGray
    if ($route.status.S -eq "RULE_MATCHED" -and [int]$route.routeStage.N -eq 30) {
      $routeMatched = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $routeMatched) { throw "Replay reached SQS, but tracker did not restore the record to RULE_MATCHED." }

  Invoke-AwsCli @("sqs", "delete-message", "--queue-url", $queueUrl, "--receipt-handle", $matched.ReceiptHandle) | Out-Null
  Write-Host "SUCCESS: PUBLISHED -> ROUTING_SUSPECTED -> Archive Replay -> RULE_MATCHED, and the event reached SQS." -ForegroundColor Green
}
finally {
  if ($payloadFile) { Remove-Item -LiteralPath $payloadFile.FullName -Force -ErrorAction SilentlyContinue }
  if ($destinationFile) { Remove-Item -LiteralPath $destinationFile.FullName -Force -ErrorAction SilentlyContinue }
  if ($routeKeyFile) { Remove-Item -LiteralPath $routeKeyFile.FullName -Force -ErrorAction SilentlyContinue }
  if ($routeRecordFile) { Remove-Item -LiteralPath $routeRecordFile.FullName -Force -ErrorAction SilentlyContinue }
  if ($routePublishFile) { Remove-Item -LiteralPath $routePublishFile.FullName -Force -ErrorAction SilentlyContinue }

  if ($originalRuleState) {
    try {
      $operation = if ($originalRuleState -eq "ENABLED") { "enable-rule" } else { "disable-rule" }
      Invoke-AwsCli @("events", $operation, "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
      Write-Host "Restored $RecoveryRuleName to $originalRuleState." -ForegroundColor DarkGray
    }
    catch {
      Write-Warning "Could not restore $RecoveryRuleName to $originalRuleState. Restore it manually."
    }
  }

  $env:PYTHONUTF8 = $previousPythonUtf8
  $env:PYTHONIOENCODING = $previousPythonIoEncoding
  $env:AWS_CLI_FILE_ENCODING = $previousAwsCliFileEncoding
  [Console]::OutputEncoding = $previousConsoleOutputEncoding
}
