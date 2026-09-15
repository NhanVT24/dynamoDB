[CmdletBinding()]
param(
  [string]$Region = "ap-southeast-1",
  [string]$Profile = "nhandev",
  [string]$StackName = "SupermarketAwsStack",
  [string]$FunctionName = "supermarket-email-publish-recovery-aws",
  [ValidateRange(1, 10)]
  [int]$MaxWorkerInvocationsPerAttempt = 5,
  [switch]$CleanupRecord
)

$ErrorActionPreference = "Stop"

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
  param([string]$Path, [object]$Value, [int]$Depth = 15)

  $json = $Value | ConvertTo-Json -Compress -Depth $Depth
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
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

function Set-RetryDueNow {
  param([string]$TableName, [string]$KeyFile, [string]$UpdateFile)

  $dueAt = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString("o")
  Write-JsonFile $UpdateFile @{
    TableName = $TableName
    Key = (Get-Content -LiteralPath $KeyFile -Raw | ConvertFrom-Json)
    ConditionExpression = "#status = :retry"
    UpdateExpression = "SET nextPublishAt = :dueAt, updatedAt = :dueAt"
    ExpressionAttributeNames = @{ "#status" = "status" }
    ExpressionAttributeValues = @{
      ":retry" = @{ S = "PUBLISH_RETRY" }
      ":dueAt" = @{ S = $dueAt }
    }
  }
  Invoke-AwsCli @("dynamodb", "update-item", "--cli-input-json", "file://$UpdateFile") | Out-Null
}

function Invoke-RecoveryLambda {
  param([string]$PayloadFile, [string]$ResponseFile)

  $invokeResult = Invoke-AwsCli @(
    "lambda", "invoke",
    "--function-name", $FunctionName,
    "--invocation-type", "RequestResponse",
    "--cli-binary-format", "raw-in-base64-out",
    "--payload", "fileb://$PayloadFile",
    $ResponseFile,
    "--output", "json"
  ) | ConvertFrom-Json

  $responseBody = if (Test-Path -LiteralPath $ResponseFile) {
    Get-Content -LiteralPath $ResponseFile -Raw
  } else { "" }
  if ($invokeResult.FunctionError) {
    throw "Recovery Lambda returned FunctionError=$($invokeResult.FunctionError): $responseBody"
  }
  return $responseBody
}

function Restore-EnvironmentValue {
  param([string]$Name, [object]$Value)

  if ($null -eq $Value) { Remove-Item "Env:$Name" -ErrorAction SilentlyContinue }
  else { Set-Item "Env:$Name" ([string]$Value) }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("email-publish-recovery-" + [guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$resolvedTemporaryDirectory = [System.IO.Path]::GetFullPath($temporaryDirectory)
$expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $resolvedTemporaryDirectory.StartsWith($expectedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use a temporary directory outside the OS temp root: $resolvedTemporaryDirectory"
}

$recordCreated = $false
$tableName = ""
$emailJobId = ""
$keyFile = Join-Path $temporaryDirectory "route-key.json"
$putFile = Join-Path $temporaryDirectory "put-route.json"
$updateFile = Join-Path $temporaryDirectory "force-due.json"
$payloadFile = Join-Path $temporaryDirectory "lambda-payload.json"
$responseFile = Join-Path $temporaryDirectory "lambda-response.json"
$deleteFile = Join-Path $temporaryDirectory "delete-route.json"

try {
  Write-Host ""
  Write-Host "EventBridge producer publish recovery test" -ForegroundColor White
  Write-Host "==========================================" -ForegroundColor DarkGray

  Write-Host "[1/7] Validate AWS credentials and deployed resources" -ForegroundColor Cyan
  $identity = Invoke-AwsCli @("sts", "get-caller-identity", "--output", "json") | ConvertFrom-Json
  $tableName = Invoke-AwsCli @(
    "cloudformation", "describe-stacks",
    "--stack-name", $StackName,
    "--query", "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue | [0]",
    "--output", "text"
  )
  $function = Invoke-AwsCli @(
    "lambda", "get-function-configuration",
    "--function-name", $FunctionName,
    "--output", "json"
  ) | ConvertFrom-Json
  if (-not $tableName -or $tableName -eq "None" -or -not $function.FunctionArn) {
    throw "Recovery resources were not found. Build the API Lambda package and deploy the latest CDK stack first."
  }
  if ([int]$function.Environment.Variables.EMAIL_EVENT_PUBLISH_MAX_ATTEMPTS -ne 5) {
    throw "Expected EMAIL_EVENT_PUBLISH_MAX_ATTEMPTS=5 on $FunctionName. Deploy the latest stack first."
  }
  Write-Host "       Account : $($identity.Account)" -ForegroundColor DarkGray
  Write-Host "       Table   : $tableName" -ForegroundColor DarkGray
  Write-Host "       Function: $($function.FunctionArn)" -ForegroundColor DarkGray

  Write-Host "[2/7] Create an isolated EMAIL_ROUTE after simulated attempt 1 failure" -ForegroundColor Cyan
  $testId = [guid]::NewGuid().ToString("N")
  $emailJobId = $testId + [guid]::NewGuid().ToString("N")
  $campaignId = "publish-recovery-test-$testId"
  $nonexistentBusName = "supermarket-missing-test-bus-$testId"
  $now = (Get-Date).ToUniversalTime().ToString("o")
  $dueAt = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString("o")

  $key = @{
    PK = @{ S = "EMAIL_ROUTE#$emailJobId" }
    SK = @{ S = "STATUS" }
  }
  Write-JsonFile $keyFile $key
  Write-JsonFile $putFile @{
    TableName = $tableName
    Item = @{
      PK = $key.PK
      SK = $key.SK
      entityType = @{ S = "EMAIL_ROUTE" }
      # StatusTimelineIndex is sparse; every declared index key must exist or
      # DynamoDB omits this record from the index entirely.
      searchName = @{ S = $emailJobId }
      emailJobId = @{ S = $emailJobId }
      campaignId = @{ S = $campaignId }
      batchIndex = @{ N = "0" }
      batchCount = @{ N = "1" }
      status = @{ S = "PUBLISH_RETRY" }
      routeStage = @{ N = "10" }
      publishAttempts = @{ N = "1" }
      nextPublishAt = @{ S = $dueAt }
      publishFailureReason = @{ S = "TEST: initial PutEvents call could not reach its configured bus" }
      eventBusName = @{ S = $nonexistentBusName }
      eventSource = @{ S = "supermarket.email.test" }
      eventDetailType = @{ S = "email.publish-recovery.failure.test" }
      eventDetail = @{ M = @{
        type = @{ S = "email.publish-recovery.failure.test" }
        testId = @{ S = $testId }
        campaignId = @{ S = $campaignId }
        emailJobId = @{ S = $emailJobId }
      } }
      createdAt = @{ S = $now }
      updatedAt = @{ S = $dueAt }
    }
    ConditionExpression = "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }
  Invoke-AwsCli @("dynamodb", "put-item", "--cli-input-json", "file://$putFile") | Out-Null
  $recordCreated = $true
  Write-Host "       emailJobId       : $emailJobId" -ForegroundColor DarkGray
  Write-Host "       nonexistent bus  : $nonexistentBusName" -ForegroundColor Yellow
  Write-Host "       initial state    : PUBLISH_RETRY / attempt 1" -ForegroundColor Yellow
  Write-Host "       Failure is real: PutEvents will reject this destination because this EventBus does not exist." -ForegroundColor Yellow

  Write-Host "[3/7] Prepare synchronous Lambda invocation payload" -ForegroundColor Cyan
  Write-JsonFile $payloadFile @{
    source = "manual-test.email-publish-recovery"
    testId = $testId
  }
  Write-Host "       The production Scheduler normally invokes this Lambda every minute." -ForegroundColor DarkGray
  Write-Host "       This test invokes it directly and moves nextPublishAt into the past between attempts." -ForegroundColor DarkGray

  Write-Host "[4/7] Drive attempts 2 through 5" -ForegroundColor Cyan
  $safetyCycles = 0
  while ($true) {
    $record = Get-RouteRecord -TableName $tableName -KeyFile $keyFile
    $status = [string]$record.status.S
    $attempt = [int]$record.publishAttempts.N
    Write-Host "       Current: status=$status attempt=$attempt reason=$($record.publishFailureReason.S)" -ForegroundColor DarkGray

    if ($status -eq "PUBLISH_FAILED") { break }
    if ($status -ne "PUBLISH_RETRY") {
      throw "Unexpected route state before retry: status=$status attempt=$attempt"
    }
    if ($attempt -ge 5) {
      throw "Attempt count reached $attempt without transitioning to PUBLISH_FAILED."
    }

    Set-RetryDueNow -TableName $tableName -KeyFile $keyFile -UpdateFile $updateFile
    # StatusTimelineIndex is eventually consistent. Give its projection time to
    # observe the forced due timestamp before invoking the worker.
    Start-Sleep -Seconds 2

    $advanced = $false
    for ($invoke = 1; $invoke -le $MaxWorkerInvocationsPerAttempt; $invoke++) {
      $responseBody = Invoke-RecoveryLambda -PayloadFile $payloadFile -ResponseFile $responseFile
      Write-Host "       Worker response: $responseBody" -ForegroundColor DarkGray
      Start-Sleep -Seconds 2
      $after = Get-RouteRecord -TableName $tableName -KeyFile $keyFile
      $afterAttempt = [int]$after.publishAttempts.N
      $afterStatus = [string]$after.status.S
      if ($afterAttempt -gt $attempt -or $afterStatus -eq "PUBLISH_FAILED") {
        Write-Host "       Transition: attempt $attempt -> $afterAttempt; status=$afterStatus" -ForegroundColor Yellow
        $advanced = $true
        break
      }
      Write-Host "       GSI has not exposed the due record yet; invoking again ($invoke/$MaxWorkerInvocationsPerAttempt)." -ForegroundColor DarkYellow
      Start-Sleep -Seconds 2
    }
    if (-not $advanced) {
      throw "Recovery worker did not claim the due route. Check StatusTimelineIndex and Lambda logs."
    }

    $safetyCycles += 1
    if ($safetyCycles -gt 5) { throw "Safety stop: recovery loop exceeded five cycles." }
  }

  Write-Host "[5/7] Assert terminal state" -ForegroundColor Cyan
  $final = Get-RouteRecord -TableName $tableName -KeyFile $keyFile
  if ([string]$final.status.S -ne "PUBLISH_FAILED") {
    throw "Expected PUBLISH_FAILED, received '$($final.status.S)'."
  }
  if ([int]$final.publishAttempts.N -ne 5) {
    throw "Expected publishAttempts=5, received '$($final.publishAttempts.N)'."
  }
  if ([int]$final.routeStage.N -ne 10) {
    throw "Expected routeStage=10 while publishing is terminally failed, received '$($final.routeStage.N)'."
  }
  Write-Host "       status          : $($final.status.S)" -ForegroundColor Green
  Write-Host "       publishAttempts : $($final.publishAttempts.N)" -ForegroundColor Green
  Write-Host "       routeStage      : $($final.routeStage.N)" -ForegroundColor Green
  Write-Host "       alertStatus     : $($final.alertStatus.S)" -ForegroundColor Green
  Write-Host "       last error      : $($final.publishFailureReason.S)" -ForegroundColor Yellow

  Write-Host "[6/7] Explain what failed" -ForegroundColor Cyan
  Write-Host "       The event never entered EventBridge because eventBusName references a nonexistent bus." -ForegroundColor DarkGray
  Write-Host "       Therefore EventBridge Archive and target DLQs cannot contain this event." -ForegroundColor DarkGray
  Write-Host "       EMAIL_ROUTE retained the complete payload and acted as the durable producer-side recovery record." -ForegroundColor DarkGray
  Write-Host "       Every worker attempt called PutEvents, received a ResourceNotFound-style failure, and scheduled the next retry." -ForegroundColor DarkGray
  Write-Host "       Attempt 5 exhausted the configured budget, so the route became PUBLISH_FAILED and SNS alerted admin." -ForegroundColor DarkGray

  Write-Host "[7/7] SUCCESS" -ForegroundColor Green
  if ($CleanupRecord) {
    Write-Host "       The isolated test record will now be deleted." -ForegroundColor DarkGray
  } else {
    Write-Host "       Test record retained for inspection: EMAIL_ROUTE#$emailJobId / STATUS" -ForegroundColor Yellow
    Write-Host "       Pass -CleanupRecord only when you explicitly want the test record removed." -ForegroundColor DarkGray
  }
}
finally {
  if ($recordCreated -and $CleanupRecord -and $tableName -and $emailJobId) {
    try {
      Write-JsonFile $deleteFile @{
        TableName = $tableName
        Key = (Get-Content -LiteralPath $keyFile -Raw | ConvertFrom-Json)
        ConditionExpression = "emailJobId = :emailJobId"
        ExpressionAttributeValues = @{ ":emailJobId" = @{ S = $emailJobId } }
      }
      Invoke-AwsCli @("dynamodb", "delete-item", "--cli-input-json", "file://$deleteFile") | Out-Null
    } catch {
      Write-Warning "Could not delete test record EMAIL_ROUTE#$emailJobId. Delete only this exact test PK manually."
    }
  }

  if (Test-Path -LiteralPath $resolvedTemporaryDirectory) {
    Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  Restore-EnvironmentValue "PYTHONUTF8" $previousPythonUtf8
  Restore-EnvironmentValue "PYTHONIOENCODING" $previousPythonIoEncoding
  Restore-EnvironmentValue "AWS_CLI_FILE_ENCODING" $previousAwsCliEncoding
}
