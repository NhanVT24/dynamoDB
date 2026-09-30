import { BadRequestException, Body, Controller, ForbiddenException, Get, InternalServerErrorException, Patch, Req } from "@nestjs/common";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { keys } from "../../database/dynamodb/keys.js";

const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarKey: z.string().max(500).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const s3 = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: env.S3_ENDPOINT
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined
});

function avatarUrl(key: string): string {
  if (!key || !env.S3_BUCKET_NAME) return "";
  const base = env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, "")
    ?? (env.S3_ENDPOINT
      ? `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${env.S3_BUCKET_NAME}`
      : `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`);
  return `${base}/${key}`;
}

@Controller("api/profile")
export class ProfileController {
  @Get("me")
  async getMe(@Req() request: FastifyRequest) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) throw new ForbiddenException("A signed-in account is required.");
    const result = await rawDb.send(new GetItemCommand({
      TableName: env.DYNAMODB_TABLE_NAME,
      Key: marshall(keys.userProfile(principal.subject)),
      ConsistentRead: true
    }));
    const profile = result.Item ? unmarshall(result.Item) : {};
    const key = typeof profile.avatarKey === "string" ? profile.avatarKey : "";
    return {
      displayName: typeof profile.displayName === "string" ? profile.displayName : "",
      avatarKey: key,
      avatarUrl: avatarUrl(key)
    };
  }

  @Patch("me")
  async updateMe(@Req() request: FastifyRequest, @Body() body: unknown) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) throw new ForbiddenException("A signed-in account is required.");
    const parsed = profilePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid profile update.");
    const { displayName, avatarKey } = parsed.data;
    if (avatarKey !== undefined && avatarKey) {
      const ownPrefix = `public/avatars/${principal.subject}/`;
      if (!avatarKey.startsWith(ownPrefix) && !avatarKey.startsWith("public/default-avatars/")) {
        throw new BadRequestException("Avatar key is not allowed.");
      }
      if (!env.S3_BUCKET_NAME) throw new InternalServerErrorException("Avatar storage is not configured.");
      try {
        await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: avatarKey }));
      } catch (error) {
        const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (failure.name === "NotFound" || failure.name === "NoSuchKey" || failure.$metadata?.httpStatusCode === 404) {
          throw new BadRequestException("Avatar image does not exist.");
        }
        throw error;
      }
    }

    const names: Record<string, string> = { "#updatedAt": "updatedAt", "#actor": "auditActorId", "#actorType": "auditActorType", "#source": "auditSource" };
    const values: Record<string, unknown> = {
      ":updatedAt": new Date().toISOString(), ":actor": principal.subject,
      ":actorType": principal.role === "admin" ? "ADMIN" : "USER", ":source": "PROFILE_API"
    };
    const changes = ["#updatedAt = :updatedAt", "#actor = :actor", "#actorType = :actorType", "#source = :source"];
    if (displayName !== undefined) {
      names["#displayName"] = "displayName";
      values[":displayName"] = displayName;
      changes.push("#displayName = :displayName");
    }
    if (avatarKey !== undefined) {
      names["#avatarKey"] = "avatarKey";
      values[":avatarKey"] = avatarKey;
      changes.push("#avatarKey = :avatarKey");
    }
    try {
      await rawDb.send(new UpdateItemCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        Key: marshall(keys.userProfile(principal.subject)),
        UpdateExpression: `SET ${changes.join(", ")}`,
        ConditionExpression: "attribute_exists(PK) AND #entityType = :entityType",
        ExpressionAttributeNames: { ...names, "#entityType": "entityType" },
        ExpressionAttributeValues: marshall({ ...values, ":entityType": "USER_PROFILE" })
      }));
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        throw new BadRequestException("User profile is not ready yet.");
      }
      throw error;
    }
    return this.getMe(request);
  }
}
