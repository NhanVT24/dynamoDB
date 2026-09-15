param(
  [string]$Region = "ap-southeast-1",
  [string]$Profile = "nhandev",
  [string]$StackName = "SupermarketAwsStack",
  [string]$EventBusName = "supermarket-platform-bus",
  [string]$RuleName = "supermarket-email-eventbridge-failure-test-rule",
  [string]$RecoveryRuleName = "supermarket-email-eventbridge-success-test-rule",
  [string]$DlqName = "supermarket-email-eventbridge-delivery-dlq"
)

$ErrorActionPreference = "Stop"

# Keep AWS CLI output ASCII-safe on Windows PowerShell 5.1.
$previousPythonUtf8 = $env:PYTHONUTF8
$previousPythonIoEncoding = $env:PYTHONIOENCODING
$previousAwsCliEncoding = $env:AWS_CLI_FILE_ENCODING
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:AWS_CLI_FILE_ENCODING = "UTF-8"

function Invoke-AwsCli {
  param([string[]]$Arguments)
  $awsArguments = @()
  if ($Profile) { $awsArguments += "--profile", $Profile }
  $awsArguments += "--region", $Region
  $awsArguments += $Arguments
  $result = & aws @awsArguments
  if ($LASTEXITCODE -ne 0) {
    $operation = $Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join " "
    throw "AWS CLI failed (exit $LASTEXITCODE): aws $operation"
  }
  return $result
}

function Write-JsonFile {
  param([string]$Path, [object]$Value, [int]$Depth = 10)
  $json = $Value | ConvertTo-Json -Compress -Depth $Depth
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-MessageAttribute {
  param([object]$Message, [string]$Name)
  if (-not $Message.MessageAttributes) { return "" }
  $property = $Message.MessageAttributes.PSObject.Properties[$Name]
  if (-not $property) { return "" }
  return [string]$property.Value.StringValue
}

function Get-RouteRecord {
  param([string]$TableName, [string]$EmailJobId, [string]$KeyFile)
  $response = Invoke-AwsCli @(
    "dynamodb", "get-item",
    "--table-name", $TableName,
    "--key", "file://$KeyFile",
    "--consistent-read",
    "--output", "json"
  ) | ConvertFrom-Json
  return $response.Item
}

function Restore-EnvironmentValue {
  param([string]$Name, [object]$Value)
  if ($null -eq $Value) { Remove-Item "Env:$Name" -ErrorAction SilentlyContinue }
  else { Set-Item "Env:$Name" ([string]$Value) }
}

$failureRuleEnabled = $false
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("email-eb-dlq-" + [guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null

try {
  Write-Host ""
  Write-Host "EventBridge -> SQS delivery failure test" -ForegroundColor White
  Write-Host "=========================================" -ForegroundColor DarkGray

  Write-Host "[1/10] Validate AWS credentials" -ForegroundColor Cyan
  $identity = Invoke-AwsCli @("sts", "get-caller-identity", "--output", "json") | ConvertFrom-Json
  Write-Host "       Account : $($identity.Account)" -ForegroundColor DarkGray
  Write-Host "       Identity: $($identity.Arn)" -ForegroundColor DarkGray

  Write-Host "[2/10] Resolve DynamoDB and SQS resources" -ForegroundColor Cyan
  $tableName = Invoke-AwsCli @(
    "cloudformation", "describe-stacks",
    "--stack-name", $StackName,
    "--query", "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue | [0]",
    "--output", "text"
  )
  if (-not $tableName -or $tableName -eq "None") { throw "TableName output was not found on stack '$StackName'." }
  $dlqUrl = (Invoke-AwsCli @("sqs", "get-queue-url", "--queue-name", $DlqName, "--output", "json") | ConvertFrom-Json).QueueUrl
  Write-Host "       Table: $tableName" -ForegroundColor DarkGray
  Write-Host "       DLQ  : $dlqUrl" -ForegroundColor DarkGray

  Write-Host "[3/10] Verify failure Rule targets and RetryPolicy" -ForegroundColor Cyan
  $targets = Invoke-AwsCli @(
    "events", "list-targets-by-rule",
    "--event-bus-name", $EventBusName,
    "--rule", $RuleName,
    "--output", "json"
  ) | ConvertFrom-Json
  foreach ($target in $targets.Targets) {
    $retry = if ($null -ne $target.RetryPolicy.MaximumRetryAttempts) { $target.RetryPolicy.MaximumRetryAttempts } else { "default" }
    $dlqArn = if ($target.DeadLetterConfig.Arn) { $target.DeadLetterConfig.Arn } else { "none" }
    Write-Host "       Target: $($target.Arn)" -ForegroundColor DarkGray
    Write-Host "         MaximumRetryAttempts=$retry; DLQ=$dlqArn" -ForegroundColor DarkGray
  }
  $sqsTarget = $targets.Targets | Where-Object { $_.Arn -like "arn:aws:sqs:*" } | Select-Object -First 1
  $trackerTarget = $targets.Targets | Where-Object { $_.Arn -like "arn:aws:lambda:*" } | Select-Object -First 1
  if (-not $sqsTarget -or -not $trackerTarget) {
    throw "The deployed test Rule must contain both SQS and tracker Lambda targets. Deploy the latest CDK stack first."
  }
  if ([int]$sqsTarget.RetryPolicy.MaximumRetryAttempts -ne 2) {
    throw "The deployed SQS target does not have MaximumRetryAttempts=2. Deploy the latest CDK stack first."
  }

  $testId = [guid]::NewGuid().ToString("N")
  # Two GUID-N values give exactly 64 characters without SHA256.HashData,
  # which is unavailable in Windows PowerShell 5.1 / older .NET Framework.
  $emailJobId = $testId + [guid]::NewGuid().ToString("N")
  $campaignId = "delivery-failure-test-$testId"
  $now = (Get-Date).ToUniversalTime().ToString("o")
  $keyFile = Join-Path $temporaryDirectory "key.json"
  $putRecordFile = Join-Path $temporaryDirectory "put-record.json"
  $eventFile = Join-Path $temporaryDirectory "event.json"
  $publishMetadataFile = Join-Path $temporaryDirectory "publish-metadata.json"

  $key = @{
    PK = @{ S = "EMAIL_ROUTE#$emailJobId" }
    SK = @{ S = "STATUS" }
  }
  Write-JsonFile $keyFile $key

  Write-Host "[4/10] Create route tracking record: PUBLISHING (stage 10)" -ForegroundColor Cyan
  Write-JsonFile $putRecordFile @{
    TableName = $tableName
    Item = @{
      PK = $key.PK
      SK = $key.SK
      entityType = @{ S = "EMAIL_ROUTE" }
      emailJobId = @{ S = $emailJobId }
      campaignId = @{ S = $campaignId }
      batchIndex = @{ N = "0" }
      batchCount = @{ N = "1" }
      status = @{ S = "PUBLISHING" }
      routeStage = @{ N = "10" }
      createdAt = @{ S = $now }
      updatedAt = @{ S = $now }
    }
    ConditionExpression = "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }
  Invoke-AwsCli @("dynamodb", "put-item", "--cli-input-json", "file://$putRecordFile") | Out-Null
  Write-Host "       emailJobId=$emailJobId" -ForegroundColor DarkGray

  Write-Host "[5/10] Enable isolated failure Rule" -ForegroundColor Cyan
  Invoke-AwsCli @("events", "disable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  Invoke-AwsCli @("events", "enable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null
  $failureRuleEnabled = $true
  Write-Host "       The Rule has two independent targets:" -ForegroundColor DarkGray
  Write-Host "       (A) tracker Lambda -> RULE_MATCHED" -ForegroundColor DarkGray
  Write-Host "       (B) denied test SQS -> delivery DLQ" -ForegroundColor DarkGray

  Write-Host "[6/10] PutEvents: publish isolated test event" -ForegroundColor Cyan
  $detail = @{
    type = "email.eventbridge.delivery-failure.test"
    testCase = "rule-matched-but-sqs-delivery-failed"
    testId = $testId
    campaignId = $campaignId
    emailJobId = $emailJobId
    batchIndex = 0
    batchCount = 1
  }
  Write-JsonFile $eventFile @{
    Entries = @(@{
      EventBusName = $EventBusName
      Source = "supermarket.email.test"
      DetailType = "email.eventbridge.delivery-failure.test"
      Detail = ($detail | ConvertTo-Json -Compress -Depth 5)
    })
  }
  $putResult = Invoke-AwsCli @("events", "put-events", "--cli-input-json", "file://$eventFile", "--output", "json") | ConvertFrom-Json
  if ([int]$putResult.FailedEntryCount -ne 0) {
    throw "PutEvents rejected the event: $($putResult.Entries[0].ErrorCode) $($putResult.Entries[0].ErrorMessage)"
  }
  $eventId = [string]$putResult.Entries[0].EventId
  Write-Host "       Bus accepted eventId=$eventId" -ForegroundColor Green

  # This mirrors the API acknowledgement after PutEvents returns. The tracker
  # may win the race and already set stage 30; never regress it to stage 20.
  $publishedAt = (Get-Date).ToUniversalTime().ToString("o")
  Write-JsonFile $publishMetadataFile @{
    TableName = $tableName
    Key = $key
    UpdateExpression = "SET eventId = :eventId, publishedAt = if_not_exists(publishedAt, :publishedAt)"
    ConditionExpression = "attribute_exists(PK)"
    ExpressionAttributeValues = @{
      ":eventId" = @{ S = $eventId }
      ":publishedAt" = @{ S = $publishedAt }
    }
  }
  Invoke-AwsCli @("dynamodb", "update-item", "--cli-input-json", "file://$publishMetadataFile") | Out-Null

  $record = Get-RouteRecord $tableName $emailJobId $keyFile
  if ([int]$record.routeStage.N -lt 20) {
    $advanceFile = Join-Path $temporaryDirectory "advance-published.json"
    Write-JsonFile $advanceFile @{
      TableName = $tableName
      Key = $key
      UpdateExpression = "SET #status = :status, routeStage = :stage, updatedAt = :updatedAt"
      ConditionExpression = "attribute_exists(PK) AND routeStage < :stage"
      ExpressionAttributeNames = @{ "#status" = "status" }
      ExpressionAttributeValues = @{
        ":status" = @{ S = "PUBLISHED" }
        ":stage" = @{ N = "20" }
        ":updatedAt" = @{ S = $publishedAt }
      }
    }
    # Capture this one command because the tracker can legitimately win the
    # race between the read above and this conditional update.
    $advanceArguments = @()
    if ($Profile) { $advanceArguments += "--profile", $Profile }
    $advanceArguments += "--region", $Region, "dynamodb", "update-item", "--cli-input-json", "file://$advanceFile"
    $advanceOutput = & aws @advanceArguments 2>&1
    $advanceExitCode = $LASTEXITCODE
    if ($advanceExitCode -eq 0) {
      Write-Host "       Tracking transition: PUBLISHING -> PUBLISHED" -ForegroundColor Green
    } else {
      $record = Get-RouteRecord $tableName $emailJobId $keyFile
      if ([int]$record.routeStage.N -ge 20) {
        Write-Host "       Tracker won the conditional-write race; current stage=$($record.routeStage.N). No regression." -ForegroundColor Yellow
      } else {
        throw "Could not advance route to PUBLISHED: $($advanceOutput -join ' ')"
      }
    }
  } else {
    Write-Host "       Tracker won the race; stage is already $($record.routeStage.N). PUBLISHED cannot overwrite it." -ForegroundColor Yellow
  }

  Write-Host "[7/10] Wait for tracker acknowledgement: RULE_MATCHED (stage 30)" -ForegroundColor Cyan
  $matched = $false
  for ($poll = 1; $poll -le 12; $poll++) {
    Start-Sleep -Seconds 2
    $record = Get-RouteRecord $tableName $emailJobId $keyFile
    $status = [string]$record.status.S
    $stage = [string]$record.routeStage.N
    Write-Host "       Poll $poll/12: status=$status stage=$stage" -ForegroundColor DarkGray
    if ([int]$stage -ge 30) { $matched = $true; break }
  }
  if (-not $matched) { throw "Tracker did not acknowledge RULE_MATCHED within 24 seconds. Check tracker Lambda logs/DLQ." }
  Write-Host "       Rule match confirmed by tracker Lambda." -ForegroundColor Green

  Write-Host "[8/10] Wait for the failed SQS delivery in EventBridge DLQ" -ForegroundColor Cyan
  $matchedDlqMessage = $null
  for ($poll = 1; $poll -le 12 -and -not $matchedDlqMessage; $poll++) {
    $received = Invoke-AwsCli @(
      "sqs", "receive-message",
      "--queue-url", $dlqUrl,
      "--max-number-of-messages", "10",
      "--visibility-timeout", "2",
      "--wait-time-seconds", "1",
      "--attribute-names", "All",
      "--message-attribute-names", "All",
      "--output", "json"
    ) | ConvertFrom-Json

    foreach ($message in @($received.Messages)) {
      # Inspect only; release every message immediately for Admin recovery.
      Invoke-AwsCli @(
        "sqs", "change-message-visibility",
        "--queue-url", $dlqUrl,
        "--receipt-handle", $message.ReceiptHandle,
        "--visibility-timeout", "0"
      ) | Out-Null
      if ([string]$message.Body -like "*$testId*") { $matchedDlqMessage = $message }
    }
    Write-Host "       Poll $poll/12: test message found=$([bool]$matchedDlqMessage)" -ForegroundColor DarkGray
    if (-not $matchedDlqMessage) { Start-Sleep -Seconds 4 }
  }
  if (-not $matchedDlqMessage) { throw "No matching delivery-DLQ message appeared within 60 seconds." }

  $errorCode = Get-MessageAttribute $matchedDlqMessage "ERROR_CODE"
  $retryAttempts = Get-MessageAttribute $matchedDlqMessage "RETRY_ATTEMPTS"
  $exhaustedBy = Get-MessageAttribute $matchedDlqMessage "EXHAUSTED_RETRY_CONDITION"
  Write-Host "       DLQ messageId : $($matchedDlqMessage.MessageId)" -ForegroundColor Green
  Write-Host "       ERROR_CODE    : $errorCode" -ForegroundColor Yellow
  Write-Host "       RETRY_ATTEMPTS: $retryAttempts" -ForegroundColor Yellow
  Write-Host "       EXHAUSTED_BY  : $exhaustedBy" -ForegroundColor Yellow
  if ($errorCode -eq "NO_PERMISSIONS" -and ($retryAttempts -eq "0" -or -not $retryAttempts)) {
    Write-Host "       AWS classified NO_PERMISSIONS as permanent, so it bypassed retries and went directly to DLQ." -ForegroundColor Yellow
    Write-Host "       MaximumRetryAttempts=2 applies only to retryable errors (for example THROTTLING/TIMEOUT)." -ForegroundColor Yellow
  }

  Write-Host "[9/10] Print final DynamoDB route record" -ForegroundColor Cyan
  $record = Get-RouteRecord $tableName $emailJobId $keyFile
  Write-Host "       PK            : $($record.PK.S)" -ForegroundColor DarkGray
  Write-Host "       status/stage  : $($record.status.S) / $($record.routeStage.N)" -ForegroundColor DarkGray
  Write-Host "       eventId       : $($record.eventId.S)" -ForegroundColor DarkGray
  Write-Host "       publishedAt   : $($record.publishedAt.S)" -ForegroundColor DarkGray
  Write-Host "       ruleMatchedAt : $($record.ruleMatchedAt.S)" -ForegroundColor DarkGray

  Write-Host "[10/10] Switch from failure route to recovery route" -ForegroundColor Cyan
  Invoke-AwsCli @("events", "disable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null
  $failureRuleEnabled = $false
  Invoke-AwsCli @("events", "enable-rule", "--name", $RecoveryRuleName, "--event-bus-name", $EventBusName) | Out-Null
  Write-Host "       Test completed." -ForegroundColor Green
  Write-Host "       Admin -> Email Center -> Queue recovery -> Refresh -> replay message $($matchedDlqMessage.MessageId)." -ForegroundColor Green
  Write-Host "       Replay calls PutEvents; the recovery Rule will deliver it to supermarket-email-eventbridge-success-test-target." -ForegroundColor Green
}
finally {
  if ($failureRuleEnabled) {
    try {
      Invoke-AwsCli @("events", "disable-rule", "--name", $RuleName, "--event-bus-name", $EventBusName) | Out-Null
    } catch {
      Write-Warning "Could not disable test Rule. Disable it manually: $RuleName"
    }
  }
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  Restore-EnvironmentValue "PYTHONUTF8" $previousPythonUtf8
  Restore-EnvironmentValue "PYTHONIOENCODING" $previousPythonIoEncoding
  Restore-EnvironmentValue "AWS_CLI_FILE_ENCODING" $previousAwsCliEncoding
}
