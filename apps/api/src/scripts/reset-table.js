import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
  waitUntilTableNotExists
} from "@aws-sdk/client-dynamodb";
import { env } from "../config/env.js";
import { rawDb } from "../db/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

async function deleteIfExists() {
  try {
    await rawDb.send(new DescribeTableCommand({ TableName }));
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      console.log(`Table ${TableName} does not exist. Skipping delete.`);
      return;
    }
    throw error;
  }

  await rawDb.send(new DeleteTableCommand({ TableName }));
  await waitUntilTableNotExists(
    { client: rawDb, maxWaitTime: 30 },
    { TableName }
  );
  console.log(`Deleted table ${TableName}.`);
}

async function createTable() {
  await rawDb.send(new CreateTableCommand({
    TableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "category", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "searchName", AttributeType: "S" },
      { AttributeName: "searchField", AttributeType: "S" },
      { AttributeName: "updatedAt", AttributeType: "S" }
    ],
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "CategoryStatusNameIndex",
        KeySchema: [
          { AttributeName: "category", KeyType: "HASH" },
          { AttributeName: "status", KeyType: "RANGE" },
          { AttributeName: "searchName", KeyType: "RANGE" },
          { AttributeName: "PK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
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
      }
    ]
  }));

  await waitUntilTableExists(
    { client: rawDb, maxWaitTime: 30 },
    { TableName }
  );
  console.log(`Created table ${TableName}.`);
}

await deleteIfExists();
await createTable();
