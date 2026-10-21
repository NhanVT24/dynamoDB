import {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { marketplaceTableDefinition } from "../database/dynamodb/table-definition.js";
import { env } from "../config/env.js";
import { rawDb } from "../database/dynamodb/client.js";

const tableDefinition = marketplaceTableDefinition(env.DYNAMODB_TABLE_NAME);

try {
  await rawDb.send(new DescribeTableCommand({ TableName: env.DYNAMODB_TABLE_NAME }));
  console.log(`Table ${env.DYNAMODB_TABLE_NAME} already exists.`);
} catch (error: any) {
  if (error.name !== "ResourceNotFoundException") throw error;

  await rawDb.send(new CreateTableCommand(tableDefinition));
  await waitUntilTableExists(
    { client: rawDb, maxWaitTime: 30 },
    { TableName: env.DYNAMODB_TABLE_NAME }
  );
  console.log(`Created table ${env.DYNAMODB_TABLE_NAME}.`);
}
