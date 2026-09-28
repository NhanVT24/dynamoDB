param(
  [string]$TableName = "MarketplaceProductsDev",
  [string]$AwsRegionName = "ap-southeast-1",
  [string]$AwsProfileName = "default",
  [int]$MaxPagesPerShard = 30
)

$ErrorActionPreference = "Stop"

if ($MaxPagesPerShard -lt 1) {
  throw "MaxPagesPerShard must be at least 1."
}

function Invoke-AwsJson {
  param([string[]]$AwsArguments)

  $previousCliEncoding = $env:AWS_CLI_OUTPUT_ENCODING
  $previousConsoleEncoding = [Console]::OutputEncoding
  try {
    # AWS CLI v2 otherwise uses the Windows code page and fails on Vietnamese text.
    $env:AWS_CLI_OUTPUT_ENCODING = "UTF-8"
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $outputLines = & aws @AwsArguments --region $AwsRegionName --profile $AwsProfileName --output json --no-cli-pager
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw "AWS CLI $($AwsArguments[0]) $($AwsArguments[1]) failed with exit code $exitCode."
    }

    return ($outputLines -join "`n") | ConvertFrom-Json
  } finally {
    [Console]::OutputEncoding = $previousConsoleEncoding
    if ($null -eq $previousCliEncoding) {
      Remove-Item Env:AWS_CLI_OUTPUT_ENCODING -ErrorAction SilentlyContinue
    } else {
      $env:AWS_CLI_OUTPUT_ENCODING = $previousCliEncoding
    }
  }
}

$table = Invoke-AwsJson -AwsArguments @("dynamodb", "describe-table", "--table-name", $TableName)
$streamArn = $table.Table.LatestStreamArn
if (-not $streamArn) {
  throw "Table '$TableName' does not have an active DynamoDB Stream."
}

Write-Host "Stream: $streamArn"

$shards = @()
$lastShardId = $null
do {
  $arguments = @("dynamodbstreams", "describe-stream", "--stream-arn", $streamArn)
  if ($lastShardId) {
    $arguments += @("--exclusive-start-shard-id", $lastShardId)
  }
  $description = Invoke-AwsJson -AwsArguments $arguments
  $shards += @($description.StreamDescription.Shards | Where-Object { $null -ne $_ })
  $lastShardId = $description.StreamDescription.LastEvaluatedShardId
} while ($lastShardId)

if ($shards.Count -eq 0) {
  Write-Host "The Stream has no shards to read."
  return
}

$matchedRecords = 0
foreach ($shard in $shards) {
  Write-Host "Reading shard: $($shard.ShardId)"
  $iteratorResponse = Invoke-AwsJson -AwsArguments @(
    "dynamodbstreams", "get-shard-iterator",
    "--stream-arn", $streamArn,
    "--shard-id", $shard.ShardId,
    "--shard-iterator-type", "TRIM_HORIZON"
  )
  $iterator = $iteratorResponse.ShardIterator

  for ($page = 0; $page -lt $MaxPagesPerShard -and $iterator; $page++) {
    $batch = Invoke-AwsJson -AwsArguments @(
      "dynamodbstreams", "get-records",
      "--shard-iterator", $iterator,
      "--limit", "1000"
    )

    foreach ($record in $batch.Records) {
      $pk = $record.dynamodb.Keys.PK.S
      if (-not $pk -or -not $pk.StartsWith("ORDER#", [System.StringComparison]::Ordinal)) {
        continue
      }

      $matchedRecords++
      [pscustomobject]@{
        EventName = $record.eventName
        PK = $pk
        SK = $record.dynamodb.Keys.SK.S
        OldStatus = $record.dynamodb.OldImage.status.S
        NewStatus = $record.dynamodb.NewImage.status.S
        EventId = $record.eventID
      }
    }

    $iterator = $batch.NextShardIterator
    if (-not $batch.Records -or $batch.Records.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

Write-Host "Order Stream records found: $matchedRecords"
Write-Host "Only retained Stream data (up to 24 hours) is available."
