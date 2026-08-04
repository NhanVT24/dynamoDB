import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { env } from "../config/env.js";
const client = new DynamoDBClient({
    region: env.AWS_REGION,
    endpoint: env.DYNAMODB_ENDPOINT,
    credentials: env.DYNAMODB_ENDPOINT
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
        : undefined
});
export { client as rawDb };
