import {
  DescribeReplayCommand,
  PutEventsCommand,
  StartReplayCommand
} from "@aws-sdk/client-eventbridge";
import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand
} from "@aws-sdk/client-sqs";
import { Injectable, Logger } from "@nestjs/common";
import { env } from "../../config/env.js";
import { eventBridgeClient } from "../../integrations/eventbridge/client.js";
import { sqsClient } from "../../integrations/sqs/client.js";

const queueConfig = {
  notifications: {
    dlqUrl: env.SQS_NOTIFICATIONS_DLQ_URL,
    replayType: "sqs",
    targetQueueUrl: env.SQS_NOTIFICATIONS_QUEUE_URL
  },
  storefrontOrders: {
    dlqUrl: env.SQS_STOREFRONT_ORDERS_DLQ_URL,
    replayType: "sqs",
    targetQueueUrl: env.SQS_STOREFRONT_ORDERS_QUEUE_URL
  },
  paymentEvents: {
    dlqUrl: env.SQS_PAYMENT_EVENTS_DLQ_URL,
    replayType: "sqs",
    targetQueueUrl: env.SQS_PAYMENT_EVENTS_QUEUE_URL
  },
  emailJobs: {
    dlqUrl: env.SQS_EMAIL_JOBS_DLQ_URL,
    replayType: "sqs",
    targetQueueUrl: env.SQS_EMAIL_JOBS_QUEUE_URL
  },
  imageUploads: {
    dlqUrl: env.SQS_IMAGE_UPLOADS_DLQ_URL,
    replayType: "sqs",
    targetQueueUrl: env.SQS_IMAGE_UPLOADS_QUEUE_URL
  },
  eventbridgeTargets: {
    dlqUrl: env.SQS_EVENTBRIDGE_TARGET_DLQ_URL,
    replayType: "eventbridge"
  },
  emailEventbridgeDelivery: {
    dlqUrl: env.SQS_EMAIL_EVENTBRIDGE_DELIVERY_DLQ_URL,
    replayType: "eventbridge"
  }
} as const;

const archiveConfig = {
  commerce: {
    archiveName: "supermarket-commerce-archive",
    archiveArn: env.EVENTBRIDGE_COMMERCE_ARCHIVE_ARN,
    eventBusName: env.EVENTBRIDGE_COMMERCE_BUS_NAME
  },
  payment: {
    archiveName: "supermarket-payment-archive",
    archiveArn: env.EVENTBRIDGE_PAYMENT_ARCHIVE_ARN,
    eventBusName: env.EVENTBRIDGE_PAYMENT_BUS_NAME
  },
  platform: {
    archiveName: "supermarket-platform-archive",
    archiveArn: env.EVENTBRIDGE_PLATFORM_ARCHIVE_ARN,
    eventBusName: env.EVENTBRIDGE_PLATFORM_BUS_NAME
  }
} as const;

type DlqKey = keyof typeof queueConfig;
type ArchiveKey = keyof typeof archiveConfig;

type ReplayQueueResult = {
  queueKey: DlqKey;
  configured: boolean;
  replayType: "sqs" | "eventbridge";
  dlqUrl?: string;
  destination?: string;
  attempted: number;
  succeeded: number;
  failed: number;
  dryRun: boolean;
  items: Array<{
    messageId: string;
    status: "preview" | "replayed" | "failed";
    destination?: string;
    error?: string;
  }>;
};

type QueueMessageSnapshot = {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, string>;
};

function getDlqKeys(): DlqKey[] {
  return Object.keys(queueConfig) as DlqKey[];
}

function getArchiveKeys(): ArchiveKey[] {
  return Object.keys(archiveConfig) as ArchiveKey[];
}

function parseRuleArnForBusName(ruleArn?: string): string | undefined {
  if (!ruleArn) return undefined;

  const ruleMarker = ":rule/";
  const markerIndex = ruleArn.indexOf(ruleMarker);
  if (markerIndex < 0) return undefined;

  const rulePath = ruleArn.slice(markerIndex + ruleMarker.length);
  const segments = rulePath.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return segments[0];
  }

  return env.EVENTBRIDGE_DEFAULT_BUS_NAME?.trim() || undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function eventBusArnFromArchiveArn(archiveArn: string, eventBusName: string): string {
  const arnSegments = archiveArn.split(":");
  if (arnSegments.length < 6 || arnSegments[2] !== "events" || !eventBusName.trim()) {
    throw new Error("Không thể xác định EventBridge bus ARN từ cấu hình archive.");
  }
  return `${arnSegments.slice(0, 5).join(":")}:event-bus/${eventBusName.trim()}`;
}

@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  listArchives() {
    return {
      archives: getArchiveKeys().map((key) => ({
        archiveKey: key,
        archiveName: archiveConfig[key].archiveName,
        archiveArn: archiveConfig[key].archiveArn ?? ""
      }))
    };
  }

  async startArchiveReplay(input: {
    archive: ArchiveKey;
    replayName?: string;
    eventStartTime: string;
    eventEndTime: string;
    ruleArns?: string[];
    description?: string;
  }) {
    const config = archiveConfig[input.archive];
    if (!config.archiveArn) {
      throw new Error(`Archive ${config.archiveName} chưa được cấu hình ARN.`);
    }
    if (!config.eventBusName) {
      throw new Error(`Archive ${config.archiveName} chưa được cấu hình EventBus name.`);
    }

    const replayName = input.replayName?.trim() || `${config.archiveName}-${Date.now()}`;
    const eventStartTime = new Date(input.eventStartTime);
    const eventEndTime = new Date(input.eventEndTime);

    if (Number.isNaN(eventStartTime.getTime()) || Number.isNaN(eventEndTime.getTime())) {
      throw new Error("Thời gian replay không hợp lệ.");
    }

    if (eventStartTime >= eventEndTime) {
      throw new Error("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc.");
    }

    this.logger.log(JSON.stringify({
      flow: "eventbridge_archive_replay",
      stage: "requested",
      archive: input.archive,
      archiveName: config.archiveName,
      eventBusName: config.eventBusName,
      replayName,
      eventStartTime: eventStartTime.toISOString(),
      eventEndTime: eventEndTime.toISOString(),
      filterRuleCount: input.ruleArns?.length ?? 0
    }));

    const response = await eventBridgeClient.send(new StartReplayCommand({
      ReplayName: replayName,
      Description: input.description?.trim() || `Replay từ archive ${config.archiveName}`,
      EventSourceArn: config.archiveArn,
      EventStartTime: eventStartTime,
      EventEndTime: eventEndTime,
      // Destination.Arn must be the source event bus ARN. Rule ARNs are only
      // valid in FilterArns; passing a rule ARN as Arn makes StartReplay fail.
      Destination: {
        Arn: eventBusArnFromArchiveArn(config.archiveArn, config.eventBusName),
        ...(input.ruleArns?.length ? { FilterArns: input.ruleArns } : {})
      }
    }));

    this.logger.log(JSON.stringify({
      flow: "eventbridge_archive_replay",
      stage: "started",
      archive: input.archive,
      replayName,
      replayArn: response.ReplayArn ?? "",
      state: response.State ?? "UNKNOWN",
      replayStartTime: response.ReplayStartTime?.toISOString() ?? null
    }));

    return {
      archiveKey: input.archive,
      archiveName: config.archiveName,
      replayName,
      replayArn: response.ReplayArn ?? "",
      state: "STARTING",
      eventStartTime: eventStartTime.toISOString(),
      eventEndTime: eventEndTime.toISOString()
    };
  }

  async getArchiveReplayStatus(replayName: string) {
    const response = await eventBridgeClient.send(new DescribeReplayCommand({
      ReplayName: replayName
    }));

    this.logger.log(JSON.stringify({
      flow: "eventbridge_archive_replay",
      stage: "status_checked",
      replayName,
      state: response.State ?? "UNKNOWN",
      stateReason: response.StateReason ?? "",
      eventLastReplayedTime: response.EventLastReplayedTime?.toISOString() ?? null
    }));

    return {
      replayName: response.ReplayName ?? replayName,
      replayArn: response.ReplayArn ?? "",
      state: response.State ?? "UNKNOWN",
      stateReason: response.StateReason ?? "",
      eventStartTime: response.EventStartTime?.toISOString() ?? null,
      eventEndTime: response.EventEndTime?.toISOString() ?? null,
      replayStartTime: response.ReplayStartTime?.toISOString() ?? null,
      replayEndTime: response.ReplayEndTime?.toISOString() ?? null,
      eventLastReplayedTime: response.EventLastReplayedTime?.toISOString() ?? null
    };
  }

  async listDlqMessages(queueKey?: DlqKey, maxMessages = 5) {
    if (queueKey) {
      return this.inspectQueue(queueKey, maxMessages);
    }

    const queues = await Promise.all(getDlqKeys().map((key) => this.inspectQueue(key, maxMessages)));
    return { queues };
  }

  async replayDlqMessages(input: {
    queue?: DlqKey;
    maxMessages: number;
    dryRun: boolean;
    messageIds?: string[];
  }) {
    this.logger.log(JSON.stringify({
      flow: "dlq_replay",
      stage: "requested",
      queue: input.queue ?? "all",
      maxMessages: input.maxMessages,
      selectedMessageCount: input.messageIds?.length ?? 0,
      dryRun: input.dryRun
    }));
    const queueKeys = input.queue ? [input.queue] : getDlqKeys();
    const queues = [];

    for (const queueKey of queueKeys) {
      queues.push(await this.replayQueueMessages(queueKey, input.maxMessages, input.dryRun, input.messageIds));
    }

    const response = {
      dryRun: input.dryRun,
      queues,
      summary: {
        attempted: queues.reduce((sum, queue) => sum + queue.attempted, 0),
        succeeded: queues.reduce((sum, queue) => sum + queue.succeeded, 0),
        failed: queues.reduce((sum, queue) => sum + queue.failed, 0)
      }
    };
    this.logger.log(JSON.stringify({ flow: "dlq_replay", stage: "completed", ...response.summary, dryRun: input.dryRun }));
    return response;
  }

  private async inspectQueue(queueKey: DlqKey, maxMessages: number) {
    const config = queueConfig[queueKey];
    if (!config.dlqUrl) {
      return {
        queueKey,
        configured: false,
        replayType: config.replayType,
        messageCount: 0,
        notVisibleCount: 0,
        messages: []
      };
    }

    const [attributesResponse, messages] = await Promise.all([
      sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: config.dlqUrl,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
      })),
      this.receiveDlqMessages(queueKey, maxMessages, true)
    ]);

    return {
      queueKey,
      configured: true,
      replayType: config.replayType,
      queueUrl: config.dlqUrl,
      messageCount: Number(attributesResponse.Attributes?.ApproximateNumberOfMessages ?? 0),
      notVisibleCount: Number(attributesResponse.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
      messages: messages.map((message) => ({
        messageId: message.messageId,
        body: message.body,
        attributes: message.attributes,
        messageAttributes: message.messageAttributes
      }))
    };
  }

  private async replayQueueMessages(
    queueKey: DlqKey,
    maxMessages: number,
    dryRun: boolean,
    messageIds?: string[]
  ): Promise<ReplayQueueResult> {
    const config = queueConfig[queueKey];
    const destination = config.replayType === "sqs" ? config.targetQueueUrl : env.EVENTBRIDGE_DEFAULT_BUS_NAME?.trim();

    if (!config.dlqUrl || (config.replayType === "sqs" && !config.targetQueueUrl)) {
      return {
        queueKey,
        configured: false,
        replayType: config.replayType,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        dryRun,
        items: []
      };
    }

    const receivedMessages = await this.receiveDlqMessages(queueKey, maxMessages, dryRun);
    const selectedMessages = messageIds?.length
      ? receivedMessages.filter((message) => messageIds.includes(message.messageId))
      : receivedMessages;
    const selectedIds = new Set(selectedMessages.map((message) => message.messageId));
    const unselectedMessages = receivedMessages.filter((message) => !selectedIds.has(message.messageId));

    // A selective replay still receives a batch from SQS. Release messages
    // that were not selected instead of hiding them for the full timeout.
    if (!dryRun && unselectedMessages.length > 0) {
      await this.resetVisibility(config.dlqUrl, unselectedMessages);
    }

    this.logger.log(JSON.stringify({
      flow: "dlq_replay",
      stage: "messages_received",
      queue: queueKey,
      received: receivedMessages.length,
      selected: selectedMessages.length,
      releasedUnselected: unselectedMessages.length,
      dryRun
    }));

    const result: ReplayQueueResult = {
      queueKey,
      configured: true,
      replayType: config.replayType,
      dlqUrl: config.dlqUrl,
      destination,
      attempted: selectedMessages.length,
      succeeded: 0,
      failed: 0,
      dryRun,
      items: []
    };

    if (selectedMessages.length === 0) {
      return result;
    }

    const successfulDeletes: Array<{ Id: string; ReceiptHandle: string }> = [];
    const failedMessages: QueueMessageSnapshot[] = [];

    for (const message of selectedMessages) {
      if (dryRun) {
        result.succeeded += 1;
        result.items.push({
          messageId: message.messageId,
          status: "preview",
          destination: this.describeReplayDestination(queueKey, message)
        });
        continue;
      }

      try {
        const replayDestination = await this.replaySingleMessage(queueKey, message);
        successfulDeletes.push({
          Id: message.messageId,
          ReceiptHandle: message.receiptHandle
        });
        result.succeeded += 1;
        result.items.push({
          messageId: message.messageId,
          status: "replayed",
          destination: replayDestination
        });
        this.logger.log(JSON.stringify({
          flow: "dlq_replay",
          stage: "message_replayed",
          queue: queueKey,
          messageId: message.messageId,
          destination: replayDestination
        }));
      } catch (error) {
        failedMessages.push(message);
        result.failed += 1;
        result.items.push({
          messageId: message.messageId,
          status: "failed",
          error: error instanceof Error ? error.message : "Replay thất bại không rõ nguyên nhân."
        });
        this.logger.error(JSON.stringify({
          flow: "dlq_replay",
          stage: "message_replay_failed",
          queue: queueKey,
          messageId: message.messageId,
          message: error instanceof Error ? error.message : "unknown"
        }));
      }
    }

    if (successfulDeletes.length > 0) {
      const deleteResponse = await sqsClient.send(new DeleteMessageBatchCommand({
        QueueUrl: config.dlqUrl,
        Entries: successfulDeletes
      }));
      const failedDeleteIds = new Set((deleteResponse.Failed ?? []).map((entry) => entry.Id).filter(Boolean));
      for (const entry of successfulDeletes.filter((candidate) => failedDeleteIds.has(candidate.Id))) {
        // DeleteMessageBatch can partially fail. Retry only the failed delete;
        // never publish the event again merely because cleanup failed.
        try {
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: config.dlqUrl,
            ReceiptHandle: entry.ReceiptHandle
          }));
        } catch (error) {
          this.logger.error(JSON.stringify({
            flow: "dlq_replay",
            stage: "replayed_message_delete_failed",
            queue: queueKey,
            messageId: entry.Id,
            message: error instanceof Error ? error.message : "unknown"
          }));
        }
      }
      this.logger.log(JSON.stringify({
        flow: "dlq_replay",
        stage: "replayed_messages_deleted",
        queue: queueKey,
        requested: successfulDeletes.length,
        batchDeleteFailed: failedDeleteIds.size
      }));
    }

    if (failedMessages.length > 0) {
      await this.resetVisibility(config.dlqUrl, failedMessages);
    }

    return result;
  }

  private async replaySingleMessage(queueKey: DlqKey, message: QueueMessageSnapshot) {
    const config = queueConfig[queueKey];
    if (config.replayType === "sqs") {
      if (!config.targetQueueUrl) {
        throw new Error(`Queue ${queueKey} chưa được cấu hình queue đích để replay.`);
      }

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.targetQueueUrl,
        MessageBody: message.body,
        MessageAttributes: Object.fromEntries(
          Object.entries(message.messageAttributes).map(([key, value]) => [key, {
            DataType: "String",
            StringValue: value
          }])
        )
      }));

      return config.targetQueueUrl;
    }

    const payload = tryParseJson(message.body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Message EventBridge DLQ không phải JSON hợp lệ.");
    }

    const eventPayload = payload as Record<string, unknown>;
    if (eventPayload.source === "aws.events" && eventPayload["detail-type"] === "Encrypted Events") {
      throw new Error("EventBridge encrypted event chưa được hỗ trợ replay tự động.");
    }

    const detail = eventPayload.detail;
    const eventBusName = parseRuleArnForBusName(message.messageAttributes.RULE_ARN)
      || env.EVENTBRIDGE_DEFAULT_BUS_NAME?.trim();

    if (!eventBusName) {
      throw new Error("Không xác định được EventBridge bus để replay.");
    }

    const response = await eventBridgeClient.send(new PutEventsCommand({
      Entries: [
        {
          EventBusName: eventBusName,
          Source: String(eventPayload.source ?? ""),
          DetailType: String(eventPayload["detail-type"] ?? ""),
          Detail: JSON.stringify(detail ?? {}),
          Time: eventPayload.time ? new Date(String(eventPayload.time)) : new Date()
        }
      ]
    }));

    if (Number(response.FailedEntryCount ?? 0) > 0) {
      throw new Error(response.Entries?.[0]?.ErrorMessage || "EventBridge replay thất bại.");
    }

    this.logger.log(JSON.stringify({
      flow: "dlq_replay",
      stage: "eventbridge_put_accepted",
      queue: queueKey,
      source: String(eventPayload.source ?? ""),
      detailType: String(eventPayload["detail-type"] ?? ""),
      eventBusName,
      eventId: response.Entries?.[0]?.EventId ?? ""
    }));

    return eventBusName;
  }

  private describeReplayDestination(queueKey: DlqKey, message: QueueMessageSnapshot) {
    const config = queueConfig[queueKey];
    if (config.replayType === "sqs") {
      return config.targetQueueUrl;
    }

    return parseRuleArnForBusName(message.messageAttributes.RULE_ARN)
      || env.EVENTBRIDGE_DEFAULT_BUS_NAME?.trim()
      || "unknown-event-bus";
  }

  private async receiveDlqMessages(queueKey: DlqKey, maxMessages: number, releaseAfterRead: boolean) {
    const config = queueConfig[queueKey];
    if (!config.dlqUrl) {
      return [];
    }

    const receiveResponse = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: config.dlqUrl,
      MaxNumberOfMessages: Math.max(1, Math.min(10, maxMessages)),
      VisibilityTimeout: 30,
      WaitTimeSeconds: 0,
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"]
    }));

    const messages = (receiveResponse.Messages ?? [])
      .filter((message) => message.MessageId && message.ReceiptHandle)
      .map((message) => ({
        messageId: message.MessageId!,
        receiptHandle: message.ReceiptHandle!,
        body: message.Body ?? "",
        attributes: message.Attributes ?? {},
        messageAttributes: Object.fromEntries(
          Object.entries(message.MessageAttributes ?? {}).map(([key, value]) => [key, value.StringValue ?? ""])
        )
      }));

    if (releaseAfterRead) {
      await this.resetVisibility(config.dlqUrl, messages);
    }

    return messages;
  }

  private async resetVisibility(queueUrl: string, messages: QueueMessageSnapshot[]) {
    if (messages.length === 0) {
      return;
    }

    await sqsClient.send(new ChangeMessageVisibilityBatchCommand({
      QueueUrl: queueUrl,
      Entries: messages.map((message) => ({
        Id: message.messageId,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: 0
      }))
    }));
  }
}
