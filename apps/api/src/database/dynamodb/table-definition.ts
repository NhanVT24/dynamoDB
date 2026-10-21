import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

/** Shared by db:init and isolated engine integration tests. */
export function marketplaceTableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST" as const,
    StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "searchName", AttributeType: "S" },
      { AttributeName: "searchField", AttributeType: "S" },
      { AttributeName: "entityType", AttributeType: "S" },
      { AttributeName: "marketingAudience", AttributeType: "S" },
      { AttributeName: "emailSearch", AttributeType: "S" },
      { AttributeName: "campaignStatus", AttributeType: "S" },
      { AttributeName: "startAt", AttributeType: "S" },
      { AttributeName: "updatedAt", AttributeType: "S" }
    ],
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "StatusTimelineIndex",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "updatedAt", KeyType: "RANGE" },
          { AttributeName: "searchName", KeyType: "RANGE" },
          { AttributeName: "PK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "SearchNameIndex",
        KeySchema: [
          { AttributeName: "searchField", KeyType: "HASH" },
          { AttributeName: "searchName", KeyType: "RANGE" },
          { AttributeName: "PK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "EntityUpdatedAtIndex",
        KeySchema: [
          { AttributeName: "entityType", KeyType: "HASH" },
          { AttributeName: "updatedAt", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "CustomerMarketingIndex",
        KeySchema: [
          { AttributeName: "marketingAudience", KeyType: "HASH" },
          { AttributeName: "emailSearch", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "SaleCampaignTimelineIndex",
        KeySchema: [
          { AttributeName: "campaignStatus", KeyType: "HASH" },
          { AttributeName: "startAt", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      }
    ]
  };
}
