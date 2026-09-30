import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as iam from "aws-cdk-lib/aws-iam";
import * as pipes from "aws-cdk-lib/aws-pipes";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface AuditLogStreamStackProps extends StackProps {
  readonly sourceStreamArn: string;
  readonly auditQueue: sqs.IQueue;
}

export class AuditLogStreamStack extends Stack {
  constructor(scope: Construct, id: string, props: AuditLogStreamStackProps) {
    super(scope, id, props);

    const pipeName = "supermarket-audit-log-stream-pipe";
    const failureQueue = new sqs.Queue(this, "AuditLogPipeDlq", {
      queueName: "supermarket-audit-log-pipe-dlq",
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true
    });
    const pipeRole = new iam.Role(this, "AuditLogPipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com")
    });
    pipeRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
      resources: [props.sourceStreamArn]
    }));
    pipeRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:ListStreams"],
      resources: ["*"]
    }));
    props.auditQueue.grantSendMessages(pipeRole);
    failureQueue.grantSendMessages(pipeRole);

    const pipe = new pipes.CfnPipe(this, "AuditLogStreamPipe", {
      name: pipeName,
      roleArn: pipeRole.roleArn,
      source: props.sourceStreamArn,
      target: props.auditQueue.queueArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: "TRIM_HORIZON",
          batchSize: 1,
          maximumRetryAttempts: 5,
          maximumRecordAgeInSeconds: 82800,
          deadLetterConfig: { arn: failureQueue.queueArn }
        },
        filterCriteria: {
          filters: [{ pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "ORDER#" }] }, SK: { S: ["ORDER", "DETAIL"] } } }
          }) }, { pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "PAYMENT#" }] }, SK: { S: ["DETAIL"] } } }
          }) }, { pattern: JSON.stringify({
            dynamodb: { Keys: { PK: { S: [{ prefix: "USER#" }] }, SK: { S: ["PROFILE", "AUTHORIZATION"] } } }
          }) }]
        }
      },
      targetParameters: {
        sqsQueueParameters: {
          messageGroupId: "$.dynamodb.Keys.PK.S",
          messageDeduplicationId: "$.eventID"
        }
      }
    });
    const pipePolicy = pipeRole.node.tryFindChild("DefaultPolicy");
    if (pipePolicy) pipe.node.addDependency(pipePolicy);

    new cloudwatch.Alarm(this, "AuditLogPipeDlqAlarm", {
      alarmName: "supermarket-audit-log-pipe-dlq-messages-visible",
      metric: failureQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5), statistic: "Maximum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "Audit Stream Pipe failure needs investigation"
    });
    new cloudwatch.Alarm(this, "AuditLogPipeFailureAlarm", {
      alarmName: "supermarket-audit-log-pipe-execution-failures",
      metric: new cloudwatch.Metric({
        namespace: "AWS/EventBridge/Pipes", metricName: "ExecutionFailed",
        dimensionsMap: { PipeName: pipeName },
        statistic: "Sum", period: Duration.minutes(5)
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });

    new CfnOutput(this, "AuditLogPipeName", { value: pipeName });
    new CfnOutput(this, "AuditLogPipeDlqUrl", { value: failureQueue.queueUrl });
  }
}
