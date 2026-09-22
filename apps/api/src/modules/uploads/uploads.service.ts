import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import {
  logQueueBusinessEvent,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { env } from "../../config/env.js";
import type { CreateReportOpenPresignInput, CreateReportUploadPresignInput, CreateUploadPresignInput } from "./uploads.schema.js";

const DEFAULT_AVATAR_PREFIX = "public/default-avatars";
const ADMIN_REPORT_PREFIX = "private/admin-reports";

const s3Client = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: env.S3_ENDPOINT
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined
});

function sanitizeFileName(fileName: string) {
  const normalized = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function resolveStoragePrefix(scope: string) {
  const normalizedScope = scope.trim().replace(/^\/+|\/+$/g, "");
  if (normalizedScope === "default-avatars") return DEFAULT_AVATAR_PREFIX;
  if (normalizedScope === "avatars") return "public/avatars";
  if (normalizedScope === "products") return "public/products";
  if (normalizedScope.startsWith("public/") || normalizedScope.startsWith("private/")) return normalizedScope;
  return `public/${normalizedScope}`;
}

function buildObjectKey(scope: string, fileName: string) {
  const safeFileName = sanitizeFileName(fileName) || "upload.bin";
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `${resolveStoragePrefix(scope)}/${datePrefix}/${randomUUID()}-${safeFileName}`;
}

function buildPublicUrl(bucketName: string, objectKey: string) {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${objectKey}`;
  }

  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${bucketName}/${objectKey}`;
  }

  return `https://${bucketName}.s3.${env.AWS_REGION}.amazonaws.com/${objectKey}`;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  async createPresignedUpload(input: CreateUploadPresignInput) {
    if (!env.S3_BUCKET_NAME) {
      throw new InternalServerErrorException("S3 bucket is not configured");
    }

    const objectKey = buildObjectKey(input.scope, input.fileName);
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ContentType: input.contentType
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
    });

    return {
      bucket: env.S3_BUCKET_NAME,
      key: objectKey,
      contentType: input.contentType,
      uploadUrl,
      fileUrl: buildPublicUrl(env.S3_BUCKET_NAME, objectKey),
      expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
    };
  }

  async createDefaultAvatarUpload(input: CreateUploadPresignInput) {
    return this.createPresignedUpload({ ...input, scope: "default-avatars" });
  }

  async listDefaultAvatars() {
    if (!env.S3_BUCKET_NAME) {
      throw new InternalServerErrorException("S3 bucket is not configured");
    }

    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: env.S3_BUCKET_NAME,
      Prefix: `${DEFAULT_AVATAR_PREFIX}/`,
      MaxKeys: 100
    }));

    return {
      items: (response.Contents ?? [])
        .filter((item) => item.Key && Number(item.Size ?? 0) > 0)
        .map((item) => ({
          key: item.Key!,
          fileName: item.Key!.split("/").at(-1) ?? item.Key!,
          fileUrl: buildPublicUrl(env.S3_BUCKET_NAME!, item.Key!),
          size: Number(item.Size ?? 0),
          updatedAt: item.LastModified?.toISOString() ?? ""
        }))
    };
  }

  async createAdminReportUpload(input: CreateReportUploadPresignInput) {
    if (!env.S3_BUCKET_NAME) {
      throw new InternalServerErrorException("S3 bucket is not configured");
    }

    const objectKey = buildObjectKey(ADMIN_REPORT_PREFIX, input.fileName);
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ContentType: input.contentType
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
    });

    return {
      bucket: env.S3_BUCKET_NAME,
      key: objectKey,
      contentType: input.contentType,
      uploadUrl,
      expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
    };
  }

  async listAdminReports() {
    if (!env.S3_BUCKET_NAME) {
      throw new InternalServerErrorException("S3 bucket is not configured");
    }

    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: env.S3_BUCKET_NAME,
      Prefix: `${ADMIN_REPORT_PREFIX}/`,
      MaxKeys: 100
    }));

    return {
      items: (response.Contents ?? [])
        .filter((item) => item.Key && Number(item.Size ?? 0) > 0)
        .map((item) => ({
          key: item.Key!,
          fileName: item.Key!.split("/").at(-1) ?? item.Key!,
          size: Number(item.Size ?? 0),
          updatedAt: item.LastModified?.toISOString() ?? ""
        }))
    };
  }

  async createAdminReportOpenUrl(input: CreateReportOpenPresignInput) {
    if (!env.S3_BUCKET_NAME) {
      throw new InternalServerErrorException("S3 bucket is not configured");
    }

    if (!input.key.startsWith(`${ADMIN_REPORT_PREFIX}/`)) {
      throw new BadRequestException("Invalid private report key");
    }

    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: input.key
    });

    return {
      key: input.key,
      downloadUrl: await getSignedUrl(s3Client, command, {
        expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
      }),
      expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS
    };
  }

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
      const fileUrl = bucket && objectKey ? buildPublicUrl(bucket, objectKey) : "";

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
