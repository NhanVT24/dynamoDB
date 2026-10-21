import type { ApplicationLogger } from "../../../common/application/queue-events.js";
import { ApplicationError } from "../../../common/application/application-error.js";
export type DlqKey = "notifications" | "storefrontOrders" | "paymentEvents" | "emailJobs" | "imageUploads" | "eventbridgeTargets" | "emailEventbridgeDelivery" | "auditLogWorker";
export interface ArchiveReplay {
    archive: "commerce" | "payment" | "platform";
    replayName?: string;
    eventStartTime: string;
    eventEndTime: string;
    ruleArns?: string[];
    description?: string;
}
export type ReplayQueueResult = {
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
export type QueueMessageSnapshot = {
    messageId: string;
    receiptHandle: string;
    body: string;
    attributes: Record<string, string>;
    messageAttributes: Record<string, string>;
};
export interface AdminGateway {
    keys(): DlqKey[];
    queue(key: DlqKey): {
        dlqUrl?: string;
        targetQueueUrl?: string;
        replayType: "sqs" | "eventbridge";
    };
    defaultBus(): string | undefined;
    receiveDlqMessages(key: DlqKey, max: number, release: boolean): Promise<QueueMessageSnapshot[]>;
    resetVisibility(url: string, messages: QueueMessageSnapshot[]): Promise<void>;
    replaySingleMessage(key: DlqKey, message: QueueMessageSnapshot): Promise<string>;
    describeReplayDestination(key: DlqKey, message: QueueMessageSnapshot): string | undefined;
    ackPublished(key: DlqKey, entries: Array<{
        id: string;
        token: string;
    }>): Promise<void>;
    listArchives(): unknown;
    listDlqMessages(key?: DlqKey, max?: number): Promise<unknown>;
    startArchiveReplay(input: ArchiveReplay): Promise<unknown>;
    getArchiveReplayStatus(name: string): Promise<unknown>;
    injectAuditLogWorkerFailure(input: {
        testId?: string;
        requestedBy: string;
    }): Promise<unknown>;
}
export class AdminOperations {
    constructor(private readonly gateway: AdminGateway, private readonly logger: ApplicationLogger) { }
    listArchives() { return this.gateway.listArchives(); }
    listDlqMessages(key?: DlqKey, max = 5) { return this.gateway.listDlqMessages(key, max); }
    getArchiveReplayStatus(name: string) { return this.gateway.getArchiveReplayStatus(name); }
    injectAuditLogWorkerFailure(input: {
        testId?: string;
        requestedBy: string;
    }) { return this.gateway.injectAuditLogWorkerFailure(input); }
    startArchiveReplay(input: ArchiveReplay) {
        const start = Date.parse(input.eventStartTime), end = Date.parse(input.eventEndTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
            throw new ApplicationError("INVALID_INPUT", "Invalid archive replay time range.");
        return this.gateway.startArchiveReplay(input);
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
        const queueKeys = input.queue ? [input.queue] : this.gateway.keys();
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
    private async replayQueueMessages(queueKey: DlqKey, maxMessages: number, dryRun: boolean, messageIds?: string[]): Promise<ReplayQueueResult> {
        const config = this.gateway.queue(queueKey);
        const destination = config.replayType === "sqs" ? config.targetQueueUrl : this.gateway.defaultBus();
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
        const receivedMessages = await this.gateway.receiveDlqMessages(queueKey, maxMessages, dryRun);
        const selectedMessages = messageIds?.length
            ? receivedMessages.filter((message) => messageIds.includes(message.messageId))
            : receivedMessages;
        const selectedIds = new Set(selectedMessages.map((message) => message.messageId));
        const unselectedMessages = receivedMessages.filter((message) => !selectedIds.has(message.messageId));
        // A selective replay still receives a batch from SQS. Release messages
        // that were not selected instead of hiding them for the full timeout.
        if (!dryRun && unselectedMessages.length > 0) {
            await this.gateway.resetVisibility(config.dlqUrl, unselectedMessages);
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
        const successfulDeletes: Array<{
            id: string;
            token: string;
        }> = [];
        const failedMessages: QueueMessageSnapshot[] = [];
        for (const message of selectedMessages) {
            if (dryRun) {
                result.succeeded += 1;
                result.items.push({
                    messageId: message.messageId,
                    status: "preview",
                    destination: this.gateway.describeReplayDestination(queueKey, message)
                });
                continue;
            }
            try {
                const replayDestination = await this.gateway.replaySingleMessage(queueKey, message);
                successfulDeletes.push({
                    id: message.messageId,
                    token: message.receiptHandle
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
            }
            catch (error) {
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
        if (successfulDeletes.length)
            await this.gateway.ackPublished(queueKey, successfulDeletes);
        if (failedMessages.length > 0) {
            await this.gateway.resetVisibility(config.dlqUrl, failedMessages);
        }
        return result;
    }
}
