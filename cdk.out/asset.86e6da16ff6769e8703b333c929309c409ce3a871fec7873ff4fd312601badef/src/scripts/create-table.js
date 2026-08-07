import { CreateTableCommand, DescribeTableCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { env } from "../config/env.js";
import { rawDb } from "../database/dynamodb/client.js";
const tableDefinition = {
    TableName: env.DYNAMODB_TABLE_NAME,
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
};
try {
    await rawDb.send(new DescribeTableCommand({ TableName: env.DYNAMODB_TABLE_NAME }));
    console.log(`Table ${env.DYNAMODB_TABLE_NAME} already exists.`);
}
catch (error) {
    if (error.name !== "ResourceNotFoundException")
        throw error;
    await rawDb.send(new CreateTableCommand(tableDefinition));
    await waitUntilTableExists({ client: rawDb, maxWaitTime: 30 }, { TableName: env.DYNAMODB_TABLE_NAME });
    console.log(`Created table ${env.DYNAMODB_TABLE_NAME}.`);
}
