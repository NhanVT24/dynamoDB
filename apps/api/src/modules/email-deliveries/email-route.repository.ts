import {
  ConditionalCheckFailedException,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;
const MAX_WATCHDOG_RESULTS = 100;
const MAX_WATCHDOG_EVALUATED_ITEMS = 1_000;

export type EmailRouteStatus =
  | "PUBLISHING"
  | "PUBLISHED"
  | "PUBLISH_UNKNOWN"
  | "RULE_MATCHED"
  | "PROCESSING"
  | "ROUTING_SUSPECTED";

export type EmailRouteRecord = {
  PK: string;
  SK: "STATUS";
  entityType: "EMAIL_ROUTE";
  emailJobId: string;
  campaignId: string;
  batchIndex: number;
  batchCount: number;
  status: EmailRouteStatus;
  routeStage: number;
  eventId?: string;
  publishedAt?: string;
  ruleMatchedAt?: string;
  processingStartedAt?: string;
  routingSuspectedAt?: string;
  alertStatus?: "PENDING" | "SENT" | "FAILED";
  alertMessageId?: string;
  publishFailureReason?: string;
  createdAt: string;
  updatedAt: string;
};

const routeStages = {
  PUBLISHING: 10,
  PUBLISHED: 20,
  RULE_MATCHED: 30,
  PROCESSING: 40
} as const;

function key(emailJobId: string) {
  return { PK: `EMAIL_ROUTE#${emailJobId}`, SK: "STATUS" } as const;
}

function item(value: Record<string, unknown>) {
  return marshall(value, { removeUndefinedValues: true });
}

function isConditionalFailure(error: unknown) {
  return error instanceof ConditionalCheckFailedException
    || (error as { name?: string } | undefined)?.name === "ConditionalCheckFailedException";
}

/**
 * Creates the expectation before PutEvents. Duplicate HTTP requests reuse the
 * same deterministic emailJobId and must never reset a route that advanced.
 */
export async function ensureEmailRoute(input: {
  emailJobId: string;
  campaignId: string;
  batchIndex: number;
  batchCount: number;
}) {
  const now = new Date().toISOString();
  const record: EmailRouteRecord = {
    ...key(input.emailJobId),
    entityType: "EMAIL_ROUTE",
    emailJobId: input.emailJobId,
    campaignId: input.campaignId,
    batchIndex: input.batchIndex,
    batchCount: input.batchCount,
    status: "PUBLISHING",
    routeStage: routeStages.PUBLISHING,
    createdAt: now,
    updatedAt: now
  };

  try {
    await rawDb.send(new PutItemCommand({
      TableName,
      Item: item(record),
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

async function advanceRoute(input: {
  emailJobId: string;
  status: "PUBLISHED" | "RULE_MATCHED" | "PROCESSING";
  routeStage: number;
  timestampField: "publishedAt" | "ruleMatchedAt" | "processingStartedAt";
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: item(key(input.emailJobId)),
      ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(routeStage) OR routeStage < :nextStage)",
      UpdateExpression: "SET #status = :status, routeStage = :nextStage, #timestamp = if_not_exists(#timestamp, :timestamp), updatedAt = :timestamp REMOVE alertStatus, publishFailureReason",
      ExpressionAttributeNames: {
        "#status": "status",
        "#timestamp": input.timestampField
      },
      ExpressionAttributeValues: item({
        ":status": input.status,
        ":nextStage": input.routeStage,
        ":timestamp": timestamp
      })
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function markEmailRoutePublished(input: {
  emailJobId: string;
  eventId: string;
  publishedAt?: string;
}) {
  const publishedAt = input.publishedAt ?? new Date().toISOString();

  // Store EventBridge correlation metadata even when the tracker has already
  // advanced the status. This update deliberately does not move updatedAt back.
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: item(key(input.emailJobId)),
    ConditionExpression: "attribute_exists(PK)",
    UpdateExpression: "SET eventId = :eventId, publishedAt = if_not_exists(publishedAt, :publishedAt)",
    ExpressionAttributeValues: item({
      ":eventId": input.eventId,
      ":publishedAt": publishedAt
    })
  }));

  return advanceRoute({
    emailJobId: input.emailJobId,
    status: "PUBLISHED",
    routeStage: routeStages.PUBLISHED,
    timestampField: "publishedAt",
    timestamp: publishedAt
  });
}

export async function markEmailRoutePublishUnknown(input: {
  emailJobId: string;
  reason: string;
}) {
  const now = new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: item(key(input.emailJobId)),
      ConditionExpression: "attribute_exists(PK) AND routeStage = :publishingStage",
      UpdateExpression: "SET #status = :status, publishFailureReason = :reason, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({
        ":publishingStage": routeStages.PUBLISHING,
        ":status": "PUBLISH_UNKNOWN",
        ":reason": input.reason.slice(0, 500),
        ":now": now
      })
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export function markEmailRouteRuleMatched(emailJobId: string, timestamp?: string) {
  return advanceRoute({
    emailJobId,
    status: "RULE_MATCHED",
    routeStage: routeStages.RULE_MATCHED,
    timestampField: "ruleMatchedAt",
    timestamp
  });
}

export function markEmailRouteProcessing(emailJobId: string, timestamp?: string) {
  return advanceRoute({
    emailJobId,
    status: "PROCESSING",
    routeStage: routeStages.PROCESSING,
    timestampField: "processingStartedAt",
    timestamp
  });
}

export async function findStalePublishedEmailRoutes(updatedBefore: string) {
  const routes: EmailRouteRecord[] = [];
  let evaluated = 0;
  let cursor: Record<string, AttributeValue> | undefined;

  do {
    const pageLimit = Math.min(100, MAX_WATCHDOG_EVALUATED_ITEMS - evaluated);
    if (pageLimit <= 0) break;

    const response = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "EntityUpdatedAtIndex",
      KeyConditionExpression: "entityType = :entityType AND updatedAt <= :updatedBefore",
      FilterExpression: "#status = :published",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({
        ":entityType": "EMAIL_ROUTE",
        ":updatedBefore": updatedBefore,
        ":published": "PUBLISHED"
      }),
      ExclusiveStartKey: cursor,
      Limit: pageLimit
    }));

    evaluated += response.ScannedCount ?? 0;
    routes.push(...(response.Items ?? []).map((value) => unmarshall(value) as EmailRouteRecord));
    cursor = response.LastEvaluatedKey;
  } while (cursor && routes.length < MAX_WATCHDOG_RESULTS && evaluated < MAX_WATCHDOG_EVALUATED_ITEMS);

  return routes.slice(0, MAX_WATCHDOG_RESULTS);
}

/** Claims one timeout exactly once. The status check closes the race where the
 * tracker advances the route after the watchdog query but before this update. */
export async function markEmailRouteRoutingSuspected(emailJobId: string) {
  const now = new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: item(key(emailJobId)),
      ConditionExpression: "#status = :published AND routeStage = :publishedStage",
      UpdateExpression: "SET #status = :suspected, routingSuspectedAt = :now, alertStatus = :pending, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({
        ":published": "PUBLISHED",
        ":publishedStage": routeStages.PUBLISHED,
        ":suspected": "ROUTING_SUSPECTED",
        ":pending": "PENDING",
        ":now": now
      })
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function markEmailRouteAlertResult(input: {
  emailJobId: string;
  sent: boolean;
  messageId?: string;
}) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: item(key(input.emailJobId)),
    // The tracker may recover the route while SNS is publishing. Persist the
    // alert outcome as audit metadata without forcing the route status back.
    ConditionExpression: "attribute_exists(PK)",
    UpdateExpression: "SET alertStatus = :alertStatus, alertMessageId = :messageId, updatedAt = :now",
    ExpressionAttributeValues: item({
      ":alertStatus": input.sent ? "SENT" : "FAILED",
      ":messageId": input.messageId ?? "",
      ":now": now
    })
  }));
}
