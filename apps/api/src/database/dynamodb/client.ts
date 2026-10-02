import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { stampAuditWrite } from "../../modules/audit-log/audit-write.js";
import { env } from "../../config/env.js";

const client = new DynamoDBClient({
  region: env.AWS_REGION,
  endpoint: env.DYNAMODB_ENDPOINT,
  credentials: env.DYNAMODB_ENDPOINT
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined
});

client.middlewareStack.add((next, context) => async (args) => {
  stampAuditWrite(context.commandName, args.input, env.DYNAMODB_TABLE_NAME);
  return next(args);
}, { step: "initialize", name: "auditWriteMetadata" });

export { client as rawDb };
