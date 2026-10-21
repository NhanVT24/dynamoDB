import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../../../config/env.js";
import { rawDb } from "../../../../database/dynamodb/client.js";
import { keys } from "../../../../database/dynamodb/keys.js";
import { ApplicationError } from "../../../../common/application/application-error.js";
import { normalizeAddresses } from "../user-address.js";
import type { ProfileRepository, ProfileAvatars, ProfilePatch } from "../application/profile.js";
export class DynamoProfiles implements ProfileRepository {
    async find(subject: string) {
        const result = await rawDb.send(new GetItemCommand({ TableName: env.DYNAMODB_TABLE_NAME,
            Key: marshall(keys.userProfile(subject)), ConsistentRead: true }));
        const row = result.Item ? unmarshall(result.Item) : {};
        return { displayName: typeof row.displayName === "string" ? row.displayName : "",
            avatarKey: typeof row.avatarKey === "string" ? row.avatarKey : "", addresses: normalizeAddresses(row.addresses) };
    }
    async update(subject: string, patch: ProfilePatch) {
        const names: Record<string, string> = { "#updatedAt": "updatedAt", "#entityType": "entityType" };
        const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString(), ":entityType": "USER_PROFILE" };
        const changes = ["#updatedAt = :updatedAt"];
        for (const field of ["displayName", "avatarKey", "addresses"] as const)
            if (patch[field] !== undefined) {
                names[`#${field}`] = field;
                values[`:${field}`] = patch[field];
                changes.push(`#${field} = :${field}`);
            }
        try {
            await rawDb.send(new UpdateItemCommand({ TableName: env.DYNAMODB_TABLE_NAME, Key: marshall(keys.userProfile(subject)),
                UpdateExpression: `SET ${changes.join(", ")}`, ConditionExpression: "attribute_exists(PK) AND #entityType = :entityType",
                ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values) }));
        }
        catch (error) {
            if ((error as {
                name?: string;
            }).name === "ConditionalCheckFailedException")
                throw new ApplicationError("INVALID_INPUT", "User profile is not ready yet.");
            throw error;
        }
    }
}
const s3 = new S3Client({ region: env.AWS_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: env.S3_ENDPOINT ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } : undefined });
export class S3ProfileAvatars implements ProfileAvatars {
    async exists(key: string) {
        if (!env.S3_BUCKET_NAME)
            throw new ApplicationError("NOT_CONFIGURED", "Avatar storage is not configured.");
        try {
            await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }));
            return true;
        }
        catch (error) {
            const failure = error as {
                name?: string;
                $metadata?: {
                    httpStatusCode?: number;
                };
            };
            if (failure.name === "NotFound" || failure.name === "NoSuchKey" || failure.$metadata?.httpStatusCode === 404)
                return false;
            throw error;
        }
    }
    publicUrl(key: string) {
        if (!key || !env.S3_BUCKET_NAME)
            return "";
        const base = env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? (env.S3_ENDPOINT
            ? `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${env.S3_BUCKET_NAME}` : `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`);
        return `${base}/${key}`;
    }
}
