import { SESv2Client } from "@aws-sdk/client-sesv2";
import { env } from "../../config/env.js";

export const sesClient = new SESv2Client({
  region: env.AWS_REGION,
  credentials: env.DYNAMODB_ENDPOINT
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined
});
