import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

/** Isolated integration test: a real Stream event exhausts publisher retries and is archived to S3. */
export class OrderAuditFailureTestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "TestOrders", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY
    });
    const workerDlq = new sqs.Queue(this, "WorkerDlq", {
      fifo: true,
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true
    });
    const mainQueue = new sqs.Queue(this, "MainQueue", {
      fifo: true,
      visibilityTimeout: Duration.minutes(2),
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: workerDlq, maxReceiveCount: 3 }
    });
    const failureBucket = new s3.Bucket(this, "PublisherFailureBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });
    const code = lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda.zip"));
    const missingQueueName = `order-audit-missing-${this.node.addr.slice(0, 8)}.fifo`;
    const missingQueueUrl = `https://sqs.${this.region}.amazonaws.com/${this.account}/${missingQueueName}`;
    const publisher = new lambda.Function(this, "FailingPublisher", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "src/entrypoints/lambda/streams/order-audit.handler",
      code,
      timeout: Duration.seconds(30),
      environment: { SQS_ORDER_AUDIT_QUEUE_URL: missingQueueUrl }
    });
    const replayPublisher = new lambda.Function(this, "ReplayPublisher", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "src/entrypoints/lambda/streams/order-audit.handler",
      code,
      timeout: Duration.seconds(30),
      environment: { SQS_ORDER_AUDIT_QUEUE_URL: mainQueue.queueUrl }
    });
    publisher.addToRolePolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [`arn:aws:sqs:${this.region}:${this.account}:${missingQueueName}`]
    }));
    mainQueue.grantSendMessages(replayPublisher);

    const worker = new lambda.Function(this, "AuditWorker", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "src/entrypoints/lambda/queue/order-audit-worker.handler",
      code,
      timeout: Duration.seconds(30),
      environment: { DYNAMODB_TABLE_NAME: table.tableName }
    });
    table.grantWriteData(worker);
    worker.addEventSource(new lambdaEventSources.SqsEventSource(mainQueue, {
      batchSize: 1,
      reportBatchItemFailures: true
    }));

    if (!table.tableStreamArn) throw new Error("Test table must have a DynamoDB Stream.");
    table.grantStreamRead(publisher);
    publisher.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [failureBucket.arnForObjects("*")],
      conditions: { StringEquals: { "s3:ResourceAccount": this.account } }
    }));
    publisher.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [failureBucket.bucketArn],
      conditions: { StringEquals: { "s3:ResourceAccount": this.account } }
    }));
    const mapping = new lambda.CfnEventSourceMapping(this, "FailingPublisherMapping", {
      eventSourceArn: table.tableStreamArn,
      functionName: publisher.functionName,
      startingPosition: "LATEST",
      batchSize: 1,
      functionResponseTypes: ["ReportBatchItemFailures"],
      maximumRetryAttempts: 2,
      maximumRecordAgeInSeconds: 3600,
      destinationConfig: { onFailure: { destination: failureBucket.bucketArn } },
      filterCriteria: {
        filters: [{ pattern: JSON.stringify({ dynamodb: { Keys: { PK: { S: [{ prefix: "ORDER#" }] }, SK: { S: ["ORDER"] } } } }) }]
      }
    });
    const publisherPolicy = publisher.role?.node.tryFindChild("DefaultPolicy");
    if (publisherPolicy) mapping.node.addDependency(publisherPolicy);

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "OrderAuditStreamFailureBucketName", { value: failureBucket.bucketName });
    new CfnOutput(this, "OrderAuditPublisherFunctionName", { value: replayPublisher.functionName });
    new CfnOutput(this, "OrderAuditFailingPublisherFunctionName", { value: publisher.functionName });
    new CfnOutput(this, "OrderAuditMainQueueUrl", { value: mainQueue.queueUrl });
    new CfnOutput(this, "OrderAuditWorkerDlqUrl", { value: workerDlq.queueUrl });
  }
}
