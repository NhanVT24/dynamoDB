import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode
} from "@aws-crypto/client-node";
import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";
import {
  adminCreateUserMessage,
  authenticationCodeMessage,
  resetPasswordMessage,
  verificationMessage
} from "./custom-message.js";

const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
const sesClient = new SESv2Client({ region: process.env.AWS_REGION });

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 1))}@${domain}`;
}

function getKmsKeyArn() {
  const keyArn = process.env.COGNITO_CUSTOM_SENDER_KMS_KEY_ARN;
  if (!keyArn) throw new Error("Missing COGNITO_CUSTOM_SENDER_KMS_KEY_ARN.");
  return keyArn;
}

async function decryptCognitoCode(encryptedCode?: string) {
  if (!encryptedCode) throw new Error("Cognito custom email sender event is missing request.code.");

  const keyring = new KmsKeyringNode({ generatorKeyId: getKmsKeyArn() });
  const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, "base64"));
  return Buffer.from(plaintext).toString("utf8");
}

function recipientEmail(event: CognitoTriggerEvent) {
  const email = normalizeEmail(event.request.userAttributes?.email);
  if (!email) throw new Error("Cognito custom email sender event is missing userAttributes.email.");
  return email;
}

function emailContent(event: CognitoTriggerEvent, code: string) {
  switch (event.triggerSource) {
    case "CustomEmailSender_SignUp":
    case "CustomEmailSender_ResendCode":
    case "CustomEmailSender_UpdateUserAttribute":
    case "CustomEmailSender_VerifyUserAttribute":
      return verificationMessage({ code, email: recipientEmail(event) });
    case "CustomEmailSender_ForgotPassword":
      return resetPasswordMessage({ code });
    case "CustomEmailSender_Authentication":
      return authenticationCodeMessage({ code });
    case "CustomEmailSender_AdminCreateUser":
      return adminCreateUserMessage({
        code,
        username: event.request.usernameParameter || event.userName
      });
    default:
      return undefined;
  }
}

function isSupportedCustomEmailSender(triggerSource?: string) {
  return [
    "CustomEmailSender_SignUp",
    "CustomEmailSender_ResendCode",
    "CustomEmailSender_UpdateUserAttribute",
    "CustomEmailSender_VerifyUserAttribute",
    "CustomEmailSender_ForgotPassword",
    "CustomEmailSender_Authentication",
    "CustomEmailSender_AdminCreateUser"
  ].includes(triggerSource || "");
}

export async function TriggerCustomEmailSender(event: CognitoTriggerEvent) {
  if (!isSupportedCustomEmailSender(event.triggerSource)) {
    console.info("[cognito-custom-email-sender] unsupported_trigger", {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName
    });
    return event;
  }

  const fromEmail = process.env.SES_AUTH_FROM_EMAIL ?? process.env.SES_FROM_EMAIL;
  if (!fromEmail) throw new Error("Missing SES_AUTH_FROM_EMAIL for Cognito custom email sender.");

  const toEmail = recipientEmail(event);
  console.info("[cognito-custom-email-sender] received", {
    triggerSource: event.triggerSource,
    userPoolId: event.userPoolId,
    userName: event.userName,
    toEmail: maskEmail(toEmail)
  });

  try {
    const code = await decryptCognitoCode(event.request.code);
    const content = emailContent(event, code);

    if (!content) return event;

    console.info("[cognito-custom-email-sender] sending_ses_email", {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName,
      toEmail: maskEmail(toEmail)
    });

    const result = await sesClient.send(new SendEmailCommand({
      FromEmailAddress: fromEmail,
      ...(process.env.SES_REPLY_TO_EMAIL ? { ReplyToAddresses: [process.env.SES_REPLY_TO_EMAIL] } : {}),
      Destination: {
        ToAddresses: [toEmail]
      },
      EmailTags: [
        { Name: "email_type", Value: "cognito_auth" },
        { Name: "trigger_source", Value: event.triggerSource || "unknown" }
      ],
      Content: {
        Simple: {
          Subject: {
            Charset: "UTF-8",
            Data: content.subject
          },
          Body: {
            Html: {
              Charset: "UTF-8",
              Data: content.message
            },
            Text: {
              Charset: "UTF-8",
              Data: content.text
            }
          }
        }
      }
    }));

    if (!result.MessageId) {
      throw new Error("SES accepted the Cognito email without returning a MessageId.");
    }

    console.info("[cognito-custom-email-sender] sent", {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName,
      toEmail: maskEmail(toEmail),
      sesMessageId: result.MessageId
    });
  } catch (error) {
    console.error("[cognito-custom-email-sender] failed", {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName,
      toEmail: maskEmail(toEmail),
      error: error instanceof Error ? error.message : "Unknown error"
    });
    throw error;
  }

  return event;
}
