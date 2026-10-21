import { Injectable, Logger } from "@nestjs/common";
import { UploadAccess, type UploadActor, type UploadInput } from "./application/upload-access.js";
import { logQueueBusinessEvent, logQueueWarn } from "../../common/logging/queue-logger.js";
@Injectable()
export class UploadsService {
 private readonly logger = new Logger(UploadsService.name);
 constructor(private readonly access: UploadAccess, private readonly publicUrl: (bucket:string,key:string)=>string) {}
 createPresignedUpload(input: UploadInput, actor: UploadActor) { return this.access.image(input,actor); }
 createDefaultAvatarUpload(input:UploadInput) { return this.access.defaultAvatar(input); }
 listDefaultAvatars() { return this.access.defaults(); }
 createAdminReportUpload(input:UploadInput) { return this.access.report(input); }
 listAdminReports() { return this.access.reports(); }
 createAdminReportOpenUrl(input:{key?:string}) { return this.access.open(input.key ?? ""); }
  async processQueueRecords(
    records: Array<{ body?: string; messageId?: string }>,
    options?: { queueName?: string; workerName?: string }
  ) {
    const settled = await Promise.allSettled(records.map(async (record) => ({
      messageId: String(record.messageId ?? ""),
      item: await this.processQueueRecord(record.body)
    })));

    const processedItems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ messageId: string; item: unknown }>).value.item)
      .filter(Boolean);

    const failedMessageIds = settled
      .flatMap((result, index) => result.status === "rejected" ? [String(records[index]?.messageId ?? "")] : [])
      .filter(Boolean);

    return {
      processed: processedItems.length,
      failedMessageIds,
      items: processedItems
    };
  }

  private async processQueueRecord(body: string | undefined) {
    if (!body) {
      logQueueWarn(this.logger, {
        queue: "imageUploads",
        status: "record_empty"
      });
      return null;
    }

    const payload = JSON.parse(body) as {
      Records?: Array<{
        eventName?: string;
        eventTime?: string;
        s3?: {
          bucket?: { name?: string };
          object?: { key?: string; size?: number };
        };
      }>;
    };

    const records = Array.isArray(payload.Records) ? payload.Records : [];
    if (records.length === 0) {
      logQueueWarn(this.logger, {
        queue: "imageUploads",
        status: "ignored_payload"
      });
      return null;
    }

    const processed = records.map((record) => {
      const bucket = String(record.s3?.bucket?.name ?? "");
      const encodedKey = String(record.s3?.object?.key ?? "");
      const objectKey = decodeURIComponent(encodedKey.replaceAll("+", " "));
      const scope = objectKey.split("/")[0] ?? "";
      const fileUrl = bucket && objectKey ? this.publicUrl(bucket, objectKey) : "";

      logQueueBusinessEvent(this.logger, {
        queue: "imageUploads",
        eventType: String(record.eventName ?? "s3.object.created"),
        status: "processed",
        details: {
          bucket,
          key: objectKey,
          scope
        }
      });

      return {
        bucket,
        key: objectKey,
        scope,
        fileUrl,
        size: Number(record.s3?.object?.size ?? 0),
        eventName: String(record.eventName ?? ""),
        uploadedAt: String(record.eventTime ?? "")
      };
    });

    return processed;
  }
}
