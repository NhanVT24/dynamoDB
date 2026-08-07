import { SQSClient } from "@aws-sdk/client-sqs";
import { env } from "../../config/env.js";

export const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: env.DYNAMODB_ENDPOINT
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined
});
