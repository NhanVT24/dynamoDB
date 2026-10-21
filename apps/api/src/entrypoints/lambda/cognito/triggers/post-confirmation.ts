import { ConfirmAccount } from "../../../../modules/customers/authorization/application/account-lifecycle.js";
import crypto from "node:crypto";
import { marshall } from "@aws-sdk/util-dynamodb";
import { normalizeAddresses, type UserAddress } from "../../../../modules/customers/authorization/user-address.js";
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  type AttributeType
} from "@aws-sdk/client-cognito-identity-provider";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { UpdateItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";
import { getAttribute, normalizeEmail, resolveAuthProvider } from "../helper/attributes.js";

const client = new CognitoIdentityProviderClient({});
const eventBridge = new EventBridgeClient({});

function addressFromClientMetadata(metadata?: Record<string, string>) {
  const ward = String(metadata?.addressWard || "").trim();
  const city = String(metadata?.addressCity || "").trim();
  const province = String(metadata?.addressProvince || "").trim();
  return normalizeAddresses([{
    ward: {
      name: ward,
      houseNumber: metadata?.addressHouseNumber ?? "",
      streetNumber: metadata?.addressStreetNumber ?? ""
    },
    city,
    province
  }]);
}

function addressAttributeValues(addresses: UserAddress[]) {
  return marshall({ addresses }).addresses;
}

async function persistConfirmedUserProfile(dynamo: DynamoDBClient, event: CognitoTriggerEvent) {
  const attributes = Object.entries(event.request.userAttributes ?? {})
    .map(([Name, Value]) => ({ Name, Value }) satisfies AttributeType);
  const subject = getAttribute(attributes, "sub");
  if (!subject) {
    throw new Error("Cannot persist a Cognito user without a sub attribute.");
  }

  const email = normalizeEmail(getAttribute(attributes, "email"));
  const displayName = getAttribute(attributes, "name") || email || "Cognito User";
  const addresses = addressFromClientMetadata(event.request.clientMetadata);
  const now = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME,
      Key: {
        PK: { S: `USER#${subject}` },
        SK: { S: "PROFILE" }
      },
      UpdateExpression: "SET #entityType = :entityType, #subject = :subject, #email = :email, #emailVerified = :emailVerified, #displayName = :displayName, #avatarKey = if_not_exists(#avatarKey, :avatarKey), #addresses = :addresses, #authProvider = :authProvider, #cognitoUsername = :cognitoUsername, #status = :status, #createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now",
      ConditionExpression: "attribute_not_exists(PK) OR #entityType <> :entityType OR #email <> :email OR #emailVerified <> :emailVerified OR #displayName <> :displayName OR attribute_not_exists(#avatarKey) OR attribute_not_exists(#addresses) OR #addresses <> :addresses OR #authProvider <> :authProvider OR #cognitoUsername <> :cognitoUsername OR #status <> :status",
      ExpressionAttributeNames: {
        "#entityType": "entityType",
        "#subject": "subject",
        "#email": "email",
        "#emailVerified": "emailVerified",
        "#displayName": "displayName",
        "#avatarKey": "avatarKey",
        "#addresses": "addresses",
        "#authProvider": "authProvider",
        "#cognitoUsername": "cognitoUsername",
        "#status": "status",
        "#createdAt": "createdAt",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":entityType": { S: "USER_PROFILE" },
        ":subject": { S: subject },
        ":email": { S: email },
        ":emailVerified": { BOOL: getAttribute(attributes, "email_verified") === "true" },
        ":displayName": { S: displayName },
        ":avatarKey": { S: "" },
        ":addresses": addressAttributeValues(addresses),
        ":authProvider": { S: resolveAuthProvider(attributes) },
        ":cognitoUsername": { S: event.userName || subject },
        ":status": { S: "CONFIRMED" },
        ":now": { S: now }
      }
    }));
  } catch (error) {
    if ((error as { name?: string } | undefined)?.name !== "ConditionalCheckFailedException") throw error;
  }

  return { subject, email, displayName };
}

function welcomeEmailJobId(subject: string) {
  return crypto.createHash("sha256").update(`account-welcome:${subject}`).digest("hex");
}

async function publishWelcomeEmailRequested(input: { subject: string; email: string; displayName: string }) {
  const eventBusName = process.env.EVENTBRIDGE_PLATFORM_BUS_NAME || process.env.EVENTBRIDGE_DEFAULT_BUS_NAME;
  if (!eventBusName) {
    throw new Error("Missing EventBridge bus name for account welcome email.");
  }

  const response = await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        EventBusName: eventBusName,
        Source: "supermarket.email",
        DetailType: "email.account_welcome.requested",
        Detail: JSON.stringify({
          type: "email.account_welcome.requested",
          emailJobId: welcomeEmailJobId(input.subject),
          userSub: input.subject,
          toEmail: input.email,
          displayName: input.displayName
        }),
        Time: new Date()
      }
    ]
  }));

  if (Number(response.FailedEntryCount ?? 0) > 0) {
    throw new Error(response.Entries?.[0]?.ErrorMessage || "Failed to publish account welcome email event.");
  }
}

export async function TriggerPostConfirmation(dynamo:DynamoDBClient,event:CognitoTriggerEvent){
 const useCase=new ConfirmAccount({
  reset:async subject=>{    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME,
      Key: { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } },
      UpdateExpression: "SET #entityType = if_not_exists(#entityType, :entityType), #subject = if_not_exists(#subject, :subject), passwordResetAt = :now",
      ExpressionAttributeNames: { "#entityType": "entityType", "#subject": "subject" },
      ExpressionAttributeValues: {
        ":now": { S: new Date().toISOString() }, ":entityType": { S: "USER_PROFILE" }, ":subject": { S: subject }
      }
    }));
},
  assignCustomer:async()=>{await client.send(new AdminAddUserToGroupCommand({UserPoolId:event.userPoolId,Username:event.userName,GroupName:"customer"}));},
  persistProfile:()=>persistConfirmedUserProfile(dynamo,event),welcome:publishWelcomeEmailRequested
 });
 await useCase.execute(event.triggerSource === "PostConfirmation_ConfirmForgotPassword" ? "password_reset" : event.triggerSource === "PostConfirmation_ConfirmSignUp" ? "sign_up" : "other",event.request.userAttributes?.sub);
 return event;
}
