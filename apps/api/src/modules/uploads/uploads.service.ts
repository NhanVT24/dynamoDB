import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import type { CreateUploadPresignInput } from "./uploads.schema.js";

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

function buildObjectKey(scope: string, fileName: string) {
  const safeFileName = sanitizeFileName(fileName) || "upload.bin";
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `${scope}/${datePrefix}/${randomUUID()}-${safeFileName}`;
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
}
