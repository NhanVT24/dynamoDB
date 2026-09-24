import { Duration, Stack } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";

export function createSesFeedbackDlq(scope: Stack): sqs.Queue {
  return new sqs.Queue(scope, "SesFeedbackDlq", {
    queueName: "supermarket-ses-feedback-dlq",
    retentionPeriod: Duration.days(14),
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true
  });
}

// Keep queues as direct children of the existing stack to preserve logical IDs.
export function createQueues(scope: Stack) {
  const notificationsDlq = new sqs.Queue(scope, "NotificationsDlq", {
    queueName: "supermarket-notifications-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const notificationsQueue = new sqs.Queue(scope, "NotificationsQueue", {
    queueName: "supermarket-notifications",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      queue: notificationsDlq,
      maxReceiveCount: 3
    }
  });

  const auditQueue = new sqs.Queue(scope, "AuditQueue", {
    queueName: "supermarket-audit-log",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(4)
  });

  const eventBridgeTargetDlq = new sqs.Queue(scope, "EventBridgeTargetDlq", {
    queueName: "supermarket-eventbridge-target-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const storefrontOrdersDlq = new sqs.Queue(scope, "StorefrontOrdersDlq", {
    queueName: "supermarket-storefront-orders-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const storefrontOrdersQueue = new sqs.Queue(scope, "StorefrontOrdersQueue", {
    queueName: "supermarket-storefront-orders",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      queue: storefrontOrdersDlq,
      maxReceiveCount: 3
    }
  });

  const paymentEventsDlq = new sqs.Queue(scope, "PaymentEventsDlq", {
    queueName: "supermarket-payment-events-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const paymentEventsQueue = new sqs.Queue(scope, "PaymentEventsQueue", {
    queueName: "supermarket-payment-events",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      queue: paymentEventsDlq,
      maxReceiveCount: 3
    }
  });

  const emailJobsDlq = new sqs.Queue(scope, "EmailJobsDlq", {
    queueName: "supermarket-email-jobs-dlq",
    visibilityTimeout: Duration.seconds(120),
    retentionPeriod: Duration.days(14)
  });

  // This queue receives failures before an email job reaches the primary
  // SQS queue (for example, EventBridge cannot SendMessage to the target).
  // It is deliberately separate from EmailJobsDlq: the latter contains jobs
  // that did reach the queue but failed in Pipe/Lambda processing.
  const emailEventBridgeDeliveryDlq = new sqs.Queue(scope, "EmailEventBridgeDeliveryDlq", {
    queueName: "supermarket-email-eventbridge-delivery-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const emailRouteTrackerDlq = new sqs.Queue(scope, "EmailRouteTrackerDlq", {
    queueName: "supermarket-email-route-tracker-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14),
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true
  });

  const emailRoutingWatchdogDlq = new sqs.Queue(scope, "EmailRoutingWatchdogDlq", {
    queueName: "supermarket-email-routing-watchdog-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14),
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true
  });

  const emailPublishRecoveryDlq = new sqs.Queue(scope, "EmailPublishRecoveryDlq", {
    queueName: "supermarket-email-publish-recovery-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14),
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true
  });

  // Disabled-by-default, isolated resources used only to verify the
  // EventBridge target-delivery DLQ path. They are never part of mail flow.
  const emailEventBridgeFailureTestTargetQueue = new sqs.Queue(scope, "EmailEventBridgeFailureTestTargetQueue", {
    queueName: "supermarket-email-eventbridge-failure-test-target",
    retentionPeriod: Duration.hours(1)
  });
  const emailEventBridgeSuccessTestQueue = new sqs.Queue(scope, "EmailEventBridgeSuccessTestQueue", {
    queueName: "supermarket-email-eventbridge-success-test-target",
    retentionPeriod: Duration.hours(1)
  });

  const emailJobsQueue = new sqs.Queue(scope, "EmailJobsQueue", {
    queueName: "supermarket-email-jobs",
    // Must outlive the Email Worker timeout so SQS cannot redeliver a job
    // while its SES request is still running.
    visibilityTimeout: Duration.seconds(120),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      queue: emailJobsDlq,
      maxReceiveCount: 5
    }
  });

  const imageUploadsDlq = new sqs.Queue(scope, "ImageUploadsDlq", {
    queueName: "supermarket-image-uploads-dlq",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(14)
  });

  const imageUploadsQueue = new sqs.Queue(scope, "ImageUploadsQueue", {
    queueName: "supermarket-image-uploads",
    visibilityTimeout: Duration.seconds(30),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      queue: imageUploadsDlq,
      maxReceiveCount: 3
    }
  });

  return {
    notificationsDlq,
    notificationsQueue,
    auditQueue,
    eventBridgeTargetDlq,
    storefrontOrdersDlq,
    storefrontOrdersQueue,
    paymentEventsDlq,
    paymentEventsQueue,
    emailJobsDlq,
    emailEventBridgeDeliveryDlq,
    emailRouteTrackerDlq,
    emailRoutingWatchdogDlq,
    emailPublishRecoveryDlq,
    emailEventBridgeFailureTestTargetQueue,
    emailEventBridgeSuccessTestQueue,
    emailJobsQueue,
    imageUploadsDlq,
    imageUploadsQueue
  };
}
