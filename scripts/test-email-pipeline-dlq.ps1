param(
  [ValidateSet("processing-failure", "inject-dlq", "inject-direct-dlq", "redrive-dlq", "recover-test-mode", "disable-test-mode", "status")]
  [string]$Mode = "processing-failure",

  [string]$Region = "ap-southeast-1",

  [string]$Profile = "nhandev",

  [string]$QueueName = "supermarket-email-jobs",

  [string]$DlqName = "supermarket-email-jobs-dlq",

  [string]$FunctionName = "supermarket-email-worker-aws"
)

$ErrorActionPreference = "Stop"

function Invoke-AwsCli {
  param([string[]]$Arguments)

  $awsArguments = @()
  if ($Profile) { $awsArguments += "--profile", $Profile }
  $awsArguments += "--region", $Region
  $awsArguments += $Arguments
  $result = & aws @awsArguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed (exit code $LASTEXITCODE): aws $($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ')"
  }
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
}

function Get-QueueUrl {
  param([string]$Name)
  $response = Invoke-AwsCli @("sqs", "get-queue-url", "--queue-name", $Name, "--output", "json") | ConvertFrom-Json
  return $response.QueueUrl
}

function Set-EmailWorkerTestMode {
  param([ValidateSet("disabled", "fail", "recover")][string]$TestMode)

  $configuration = Invoke-AwsCli @(
    "lambda", "get-function-configuration", "--function-name", $FunctionName, "--output", "json"
  ) | ConvertFrom-Json
  $variables = @{}
  $configuration.Environment.Variables.PSObject.Properties | ForEach-Object {
    $variables[$_.Name] = [string]$_.Value
  }
  $variables.EMAIL_WORKER_TEST_MODE = $TestMode
  $environment = @{ Variables = $variables } | ConvertTo-Json -Compress
  $environmentFile = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText(
      $environmentFile.FullName,
      $environment,
      [System.Text.UTF8Encoding]::new($false)
    )
    # PowerShell strips JSON quotes when it is passed inline to aws.exe.
    # file:// preserves the exact JSON document for AWS CLI parsing.
    Invoke-AwsCli @(
      "lambda", "update-function-configuration", "--function-name", $FunctionName,
      "--environment", "file://$($environmentFile.FullName)", "--output", "json"
    ) | Out-Null
  }
  finally {
    Remove-Item -LiteralPath $environmentFile.FullName -Force -ErrorAction SilentlyContinue
  }
  Invoke-AwsCli @("lambda", "wait", "function-updated", "--function-name", $FunctionName)
}

function New-RedriveTestMessage {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([guid]::NewGuid().ToString()))
    $testJobId = ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
  }

  return (@{
    detail = @{
      type = "email.sale_campaign.requested"
      campaignId = "redrive-test"
      emailJobId = $testJobId
      batchIndex = 0
      batchCount = 1
      senderEmail = "sender@simulator.amazonses.com"
      recipients = @("success@simulator.amazonses.com")
      subject = "[TEST ONLY] SQS redrive"
      html = "<p>Test only</p>"
      text = "Test only"
      testOnly = @{
        failUntilReceiveCount = 10
        skipSesOnSuccess = $true
      }
    }
  } | ConvertTo-Json -Compress -Depth 5)
}

function Send-SqsMessage {
  param(
    [string]$TargetQueueUrl,
    [string]$MessageBody
  )

  $requestFile = New-TemporaryFile
  try {
    $request = @{ QueueUrl = $TargetQueueUrl; MessageBody = $MessageBody } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(
      $requestFile.FullName,
      $request,
      [System.Text.UTF8Encoding]::new($false)
    )
    # `--message-body $json` loses JSON quotes in Windows PowerShell. Passing
    # the whole AWS request through cli-input-json is quote-safe.
    Invoke-AwsCli @("sqs", "send-message", "--cli-input-json", "file://$($requestFile.FullName)", "--output", "json")
  }
  finally {
    Remove-Item -LiteralPath $requestFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

Assert-AwsCredentials
$queueUrl = Get-QueueUrl $QueueName
$dlqUrl = Get-QueueUrl $DlqName

if ($Mode -eq "status") {
  $attributes = Invoke-AwsCli @(
    "sqs", "get-queue-attributes", "--queue-url", $dlqUrl,
    "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible",
    "--output", "json"
  ) | ConvertFrom-Json
  Write-Host "DLQ: $DlqName" -ForegroundColor Cyan
  $attributes.Attributes | Format-List
  exit 0
}

if ($Mode -eq "disable-test-mode") {
  Set-EmailWorkerTestMode "disabled"
  Write-Host "Email worker test mode is disabled." -ForegroundColor Green
  exit 0
}

if ($Mode -eq "recover-test-mode") {
  Set-EmailWorkerTestMode "recover"
  Write-Host "Email worker test mode is now recover." -ForegroundColor Green
  Write-Host "You can safely select the TEST ONLY message in Email Center and click Redrive to email queue." -ForegroundColor Cyan
  Write-Host "After verification, run this script with -Mode disable-test-mode." -ForegroundColor Yellow
  exit 0
}

if ($Mode -eq "inject-dlq") {
  Set-EmailWorkerTestMode "fail"
  $testMessage = New-RedriveTestMessage

  Send-SqsMessage -TargetQueueUrl $queueUrl -MessageBody $testMessage | Write-Host
  Write-Host "Injected a test job. It now fails on every receive and reaches $DlqName after 5 receives." -ForegroundColor Yellow
  Write-Host "After it reaches the DLQ, run this script with -Mode redrive-dlq." -ForegroundColor Cyan
  exit 0
}

if ($Mode -eq "inject-direct-dlq") {
  # Fast path: useful for testing the operational DLQ redrive procedure.
  # It bypasses Pipe/Lambda retries, so it does not test automatic retry.
  $testMessage = New-RedriveTestMessage
  Send-SqsMessage -TargetQueueUrl $dlqUrl -MessageBody $testMessage | Write-Host
  Write-Host "Injected one safe test message directly into $DlqName. No SES call and no waiting required." -ForegroundColor Green
  Write-Host "Now run the same script with -Mode redrive-dlq to move it back to $QueueName." -ForegroundColor Cyan
  exit 0
}

if ($Mode -eq "redrive-dlq") {
  $dlqAttributes = Invoke-AwsCli @(
    "sqs", "get-queue-attributes", "--queue-url", $dlqUrl,
    "--attribute-names", "QueueArn", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible",
    "--output", "json"
  ) | ConvertFrom-Json
  $visible = [int]$dlqAttributes.Attributes.ApproximateNumberOfMessages
  $notVisible = [int]$dlqAttributes.Attributes.ApproximateNumberOfMessagesNotVisible
  if ($visible -ne 1 -or $notVisible -ne 0) {
    throw "Refusing native redrive: DLQ must contain exactly one visible test message (visible=$visible, notVisible=$notVisible). Use an isolated test environment."
  }

  Set-EmailWorkerTestMode "recover"
  $sourceAttributes = Invoke-AwsCli @("sqs", "get-queue-attributes", "--queue-url", $queueUrl, "--attribute-names", "QueueArn", "--output", "json") | ConvertFrom-Json
  try {
    Invoke-AwsCli @(
      "sqs", "start-message-move-task", "--source-arn", $dlqAttributes.Attributes.QueueArn,
      "--destination-arn", $sourceAttributes.Attributes.QueueArn, "--max-number-of-messages-per-second", "1", "--output", "json"
    ) | Write-Host
    Write-Host "Native DLQ redrive started. The message returns to $QueueName and succeeds in recover mode without SES." -ForegroundColor Green
  }
  catch {
    # Messages manually sent straight to a DLQ do not have SQS's original
    # source metadata, so StartMessageMoveTask cannot identify their source.
    # Requeue exactly one message rather than moving unrelated DLQ messages.
    $received = Invoke-AwsCli @(
      "sqs", "receive-message", "--queue-url", $dlqUrl, "--max-number-of-messages", "1",
      "--visibility-timeout", "60", "--wait-time-seconds", "0", "--output", "json"
    ) | ConvertFrom-Json
    $message = @($received.Messages)[0]
    if (-not $message) { throw "Native redrive failed and no DLQ message was available for safe custom requeue." }
    Send-SqsMessage -TargetQueueUrl $queueUrl -MessageBody $message.Body | Out-Null
    Invoke-AwsCli @("sqs", "delete-message", "--queue-url", $dlqUrl, "--receipt-handle", $message.ReceiptHandle) | Out-Null
    Write-Host "Native redrive was unavailable for a manually injected DLQ message; safely requeued that one message to $QueueName instead." -ForegroundColor Green
  }
  Write-Host "Run -Mode disable-test-mode when verification is complete." -ForegroundColor Yellow
  exit 0
}

# This payload fails the email worker's Zod validation before any SES call.
# Pipe leaves it in the primary queue; after maxReceiveCount (currently 5),
# SQS moves it to the configured processing DLQ. Do not use real recipient data.
$testMessage = @{
  type = "email.sale_campaign.requested"
  campaignId = "dlq-test"
  testCase = "intentionally-invalid-email-job"
} | ConvertTo-Json -Compress

Send-SqsMessage -TargetQueueUrl $queueUrl -MessageBody $testMessage | Write-Host

Write-Host "Injected an invalid job into $QueueName." -ForegroundColor Yellow
Write-Host "It will fail before SES, be retried by SQS/Pipe, then move to $DlqName after 5 receives." -ForegroundColor Yellow
Write-Host "Check it with: .\scripts\test-email-pipeline-dlq.ps1 -Mode status -Region $Region" -ForegroundColor Cyan
