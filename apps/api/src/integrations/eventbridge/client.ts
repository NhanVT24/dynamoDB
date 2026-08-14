import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { env } from "../../config/env.js";

export const eventBridgeClient = new EventBridgeClient({
  region: env.AWS_REGION
});
