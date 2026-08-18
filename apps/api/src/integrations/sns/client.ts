import { SNSClient } from "@aws-sdk/client-sns";
import { env } from "../../config/env.js";

export const snsClient = new SNSClient({
  region: env.AWS_REGION
});
