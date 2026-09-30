import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface AuditLogStreamStackProps extends StackProps {
  readonly sourceStreamArn: string;
  readonly auditQueue: sqs.IQueue;
}

export class AuditLogStreamStack extends Stack {
  constructor(scope: Construct, id: string, props: AuditLogStreamStackProps) {
    super(scope, id, props);

    const publisher = new lambda.Function(this, "AuditLogStreamFunction", {
      functionName: "supermarket-audit-log-stream",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      handler: "src/entrypoints/lambda/streams/audit-log.handler",
      timeout: Duration.seconds(30),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda.zip")),
      environment: { SQS_AUDIT_LOG_QUEUE_URL: props.auditQueue.queueUrl }
    });
    props.auditQueue.grantSendMessages(publisher);
    publisher.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
      resources: [props.sourceStreamArn]
    }));
    publisher.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:ListStreams"],
      resources: ["*"]
    }));

    const streamDlq = new sqs.Queue(this, "AuditLogStreamDlq", {
      queueName: "supermarket-audit-log-stream-dlq",
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true
    });
    const ruleTargetDlq = new sqs.Queue(this, "AuditLogStreamRuleTargetDlq", {
      queueName: "supermarket-audit-log-stream-rule-target-dlq",
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true
    });
    const failureBucket = new s3.Bucket(this, "AuditLogStreamFailureBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      eventBridgeEnabled: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(90) }]
    });
    new events.Rule(this, "AuditLogStreamFailureObjectRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [failureBucket.bucketName] },
          object: { key: [{ prefix: "aws/lambda/" }] }
        }
      },
      targets: [new eventsTargets.SqsQueue(streamDlq, {
        deadLetterQueue: ruleTargetDlq,
        retryAttempts: 2
      })]
    });
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

    const mapping = new lambda.CfnEventSourceMapping(this, "AuditLogStreamMapping", {
      eventSourceArn: props.sourceStreamArn,
      functionName: publisher.functionName,
      startingPosition: "TRIM_HORIZON",
      batchSize: 10,
      bisectBatchOnFunctionError: true,
      functionResponseTypes: ["ReportBatchItemFailures"],
      maximumRetryAttempts: 5,
      destinationConfig: { onFailure: { destination: failureBucket.bucketArn } },
      filterCriteria: {
        filters: [{
          pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "ORDER#" }] }, SK: { S: ["ORDER", "DETAIL"] } } }
          })
        }, {
          pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "PAYMENT#" }] }, SK: { S: ["DETAIL"] } } }
          })
        }, {
          pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "USER#" }] }, SK: { S: ["PROFILE", "AUTHORIZATION"] } } }
          })
        }]
      }
    });
    const publisherPolicy = publisher.role?.node.tryFindChild("DefaultPolicy");
    if (publisherPolicy) mapping.node.addDependency(publisherPolicy);

    new cloudwatch.Alarm(this, "AuditLogStreamDlqAlarm", {
      alarmName: "supermarket-audit-log-stream-dlq-messages-visible",
      metric: streamDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5), statistic: "Maximum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "Audit Stream failure object needs investigation"
    });
    new cloudwatch.Alarm(this, "AuditLogStreamRuleTargetDlqAlarm", {
      alarmName: "supermarket-audit-log-stream-rule-target-dlq-messages-visible",
      metric: ruleTargetDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5), statistic: "Maximum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "Audit Stream failure notification could not reach its queue"
    });
    new cloudwatch.Alarm(this, "AuditLogStreamLagAlarm", {
      alarmName: "supermarket-audit-log-stream-lag",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda", metricName: "IteratorAge",
        dimensionsMap: { FunctionName: publisher.functionName },
        statistic: "Maximum", period: Duration.minutes(5)
      }),
      threshold: Duration.hours(1).toMilliseconds(),
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Audit log Stream publisher is at least one hour behind"
    });
    new cloudwatch.Alarm(this, "AuditLogStreamDestinationFailureAlarm", {
      alarmName: "supermarket-audit-log-stream-destination-failures",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda", metricName: "DestinationDeliveryFailures",
        dimensionsMap: { FunctionName: publisher.functionName },
        statistic: "Sum", period: Duration.minutes(5)
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Audit log Stream failed to archive discarded records"
    });

    new CfnOutput(this, "AuditLogStreamDlqUrl", { value: streamDlq.queueUrl });
    new CfnOutput(this, "AuditLogStreamFailureBucketName", { value: failureBucket.bucketName });
    new CfnOutput(this, "AuditLogPublisherFunctionName", { value: publisher.functionName });
  }
}
