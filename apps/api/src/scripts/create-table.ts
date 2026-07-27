import {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { env } from "../config/env.js";
import { rawDb } from "../db/client.js";

try {
  await rawDb.send(new DescribeTableCommand({ TableName: env.DYNAMODB_TABLE_NAME }));
  console.log(`Table ${env.DYNAMODB_TABLE_NAME} already exists.`);
} catch (error) {
  if ((error as Error).name !== "ResourceNotFoundException") throw error;
  await rawDb.send(new CreateTableCommand({
    TableName: env.DYNAMODB_TABLE_NAME,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" }
    ],
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" }
    ],
    GlobalSecondaryIndexes: [{
      IndexName: "GSI1",
      KeySchema: [
        { AttributeName: "GSI1PK", KeyType: "HASH" },
        { AttributeName: "GSI1SK", KeyType: "RANGE" }
      ],
      Projection: { ProjectionType: "ALL" }
    }]
  }));
  await waitUntilTableExists(
    { client: rawDb, maxWaitTime: 30 },
    { TableName: env.DYNAMODB_TABLE_NAME }
  );
  console.log(`Created table ${env.DYNAMODB_TABLE_NAME}.`);
}
