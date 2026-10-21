import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";
import { readCsvEnv } from "../helper/env.js";
import { PrepareSignUp } from "../../../../modules/customers/authorization/application/prepare-sign-up.js";
import { readBooleanEnv } from "../helper/env.js";
import {
  assertEmailNotAlreadyRegistered,
  linkExternalProviderToNativeUser
} from "../helper/external-provider-linking.js";

export async function TriggerPreSignUp(event:CognitoTriggerEvent) {
 const email=normalizeEmail(event.request.userAttributes?.email);
 const useCase=new PrepareSignUp({allowedDomains:readCsvEnv("COGNITO_SIGNUP_ALLOWED_EMAIL_DOMAINS"),blockedDomains:readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAIL_DOMAINS"),blockedEmails:readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAILS")},
 {unique:()=>assertEmailNotAlreadyRegistered(event.userPoolId,email),link:()=>linkExternalProviderToNativeUser(event,email)},
 {confirmNative:readBooleanEnv("COGNITO_AUTO_CONFIRM_NATIVE_SIGNUP"),verifyNative:readBooleanEnv("COGNITO_AUTO_VERIFY_NATIVE_EMAIL")});
 const source=event.triggerSource === "PreSignUp_ExternalProvider" ? "external" : event.triggerSource === "PreSignUp_SignUp" ? "native" : "other";
 Object.assign(event.response,await useCase.execute(email,source));return event;
}
