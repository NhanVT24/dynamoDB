import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { ApplicationError } from "../../../common/application/application-error.js";
import type { UploadInput, UploadStorage } from "../application/upload-access.js";
const DEFAULT_AVATAR_PREFIX = "public/default-avatars";
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
    if (normalizedScope === "default-avatars")
        return DEFAULT_AVATAR_PREFIX;
    if (normalizedScope === "avatars")
        return "public/avatars";
    if (normalizedScope === "products")
        return "public/products";
    if (normalizedScope.startsWith("public/") || normalizedScope.startsWith("private/"))
        return normalizedScope;
    return `public/${normalizedScope}`;
}
function buildObjectKey(scope: string, fileName: string) {
    const safeFileName = sanitizeFileName(fileName) || "upload.bin";
    const datePrefix = new Date().toISOString().slice(0, 10);
    return `${resolveStoragePrefix(scope)}/${datePrefix}/${randomUUID()}-${safeFileName}`;
}
export function buildPublicUrl(bucketName: string, objectKey: string) {
    if (env.S3_PUBLIC_BASE_URL) {
        return `${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${objectKey}`;
    }
    if (env.S3_ENDPOINT) {
        return `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${bucketName}/${objectKey}`;
    }
    return `https://${bucketName}.s3.${env.AWS_REGION}.amazonaws.com/${objectKey}`;
}
export class S3UploadStorage implements UploadStorage {
    private bucket() { if (!env.S3_BUCKET_NAME)
        throw new ApplicationError("NOT_CONFIGURED", "S3 bucket is not configured"); return env.S3_BUCKET_NAME; }
    async put(scope: string, input: UploadInput) {
        const bucket = this.bucket(), key = buildObjectKey(scope, input.fileName ?? "upload.bin");
        const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType }), { expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS });
        return { bucket, key, contentType: input.contentType ?? "application/octet-stream", uploadUrl, fileUrl: buildPublicUrl(bucket, key), expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS };
    }
    async list(prefix: string) {
        const bucket = this.bucket();
        const result = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + "/", MaxKeys: 100 }));
        return { items: (result.Contents ?? []).filter(item => item.Key && Number(item.Size ?? 0) > 0).map(item => ({ key: item.Key!, fileName: item.Key!.split("/").at(-1) ?? item.Key!, fileUrl: buildPublicUrl(bucket, item.Key!), size: Number(item.Size ?? 0), updatedAt: item.LastModified?.toISOString() ?? "" })) };
    }
    async open(key: string) { const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket(), Key: key }), { expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS }); return { key, downloadUrl, expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS }; }
}
