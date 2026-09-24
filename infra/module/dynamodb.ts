import { RemovalPolicy, Stack } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

// Create the table under the existing stack so its logical ID does not change.
export function createMarketplaceTable(scope: Stack, tableName: string, includeSaleCampaignTimelineIndex: boolean) {
  const table = new dynamodb.CfnTable(scope, "MarketplaceProductsTable", {
    tableName,
    billingMode: "PAY_PER_REQUEST",
    attributeDefinitions: [
      { attributeName: "PK", attributeType: "S" },
      { attributeName: "SK", attributeType: "S" },
      { attributeName: "status", attributeType: "S" },
      { attributeName: "searchName", attributeType: "S" },
      { attributeName: "searchField", attributeType: "S" },
      { attributeName: "entityType", attributeType: "S" },
      { attributeName: "marketingAudience", attributeType: "S" },
      { attributeName: "emailSearch", attributeType: "S" },
      ...(includeSaleCampaignTimelineIndex ? [
        { attributeName: "campaignStatus", attributeType: "S" },
        { attributeName: "startAt", attributeType: "S" }
      ] : []),
      { attributeName: "updatedAt", attributeType: "S" }
    ],
    keySchema: [
      { attributeName: "PK", keyType: "HASH" },
      { attributeName: "SK", keyType: "RANGE" }
    ],
    globalSecondaryIndexes: [
      {
        indexName: "StatusTimelineIndex",
        keySchema: [
          { attributeName: "status", keyType: "HASH" },
          { attributeName: "updatedAt", keyType: "RANGE" },
          { attributeName: "searchName", keyType: "RANGE" },
          { attributeName: "PK", keyType: "RANGE" }
        ],
        projection: { projectionType: "ALL" }
      },
      {
        indexName: "SearchNameIndex",
        keySchema: [
          { attributeName: "searchField", keyType: "HASH" },
          { attributeName: "searchName", keyType: "RANGE" },
          { attributeName: "PK", keyType: "RANGE" }
        ],
        projection: { projectionType: "ALL" }
      },
      {
        indexName: "EntityUpdatedAtIndex",
        keySchema: [
          { attributeName: "entityType", keyType: "HASH" },
          { attributeName: "updatedAt", keyType: "RANGE" }
        ],
        projection: { projectionType: "ALL" }
      },
      {
        indexName: "CustomerMarketingIndex",
        keySchema: [
          { attributeName: "marketingAudience", keyType: "HASH" },
          { attributeName: "emailSearch", keyType: "RANGE" }
        ],
        projection: { projectionType: "ALL" }
      },
      ...(includeSaleCampaignTimelineIndex ? [{
        indexName: "SaleCampaignTimelineIndex",
        keySchema: [
          { attributeName: "campaignStatus", keyType: "HASH" },
          { attributeName: "startAt", keyType: "RANGE" }
        ],
        projection: { projectionType: "ALL" }
      }] : [])
    ]
  });
  table.applyRemovalPolicy(RemovalPolicy.DESTROY);

  return table;
}
