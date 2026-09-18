import {
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "./types.js";
import { TriggerCustomMessage } from "./triggers/custom-message.js";
import { TriggerPreAuthentication } from "./triggers/pre-authentication.js";
import { TriggerPreTokenGeneration } from "./triggers/pre-token-generation.js";
import { TriggerPostAuthentication } from "./triggers/post-authentications.js";
import { TriggerPostConfirmation } from "./triggers/post-confirmation.js";

const client = new CognitoIdentityProviderClient({});
const dynamo = new DynamoDBClient({});

export const handler = async (event: CognitoTriggerEvent) => {
  if (String(event.triggerSource || "").startsWith("CustomMessage_")) {
    return TriggerCustomMessage(event);
  }

  if (event.triggerSource === "PreAuthentication_Authentication") {
    return TriggerPreAuthentication(dynamo, event);
  }

  if (event.triggerSource === "PostConfirmation_ConfirmSignUp") {
    return TriggerPostConfirmation(dynamo, event);
  }

  if (event.triggerSource === "PostAuthentication_Authentication") {
    return TriggerPostAuthentication(dynamo, event);
  }

  if (String(event.triggerSource || "").startsWith("TokenGeneration_")) {
    return TriggerPreTokenGeneration(client, dynamo, event);
  }

  return event;
};
