import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";
import { assertSignUpEmailAllowed } from "../helper/email-policy.js";
import { readBooleanEnv } from "../helper/env.js";
import {
  assertEmailNotAlreadyRegistered,
  linkExternalProviderToNativeUser
} from "../helper/external-provider-linking.js";

export async function TriggerPreSignUp(event: CognitoTriggerEvent) {
  const email = normalizeEmail(event.request.userAttributes?.email);
  if (!email) {
    throw new Error("Email is required to create an account.");
  }

  assertSignUpEmailAllowed(email);

  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    await linkExternalProviderToNativeUser(event, email);
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  if (event.triggerSource === "PreSignUp_SignUp") {
    await assertEmailNotAlreadyRegistered(event.userPoolId, email);

    if (readBooleanEnv("COGNITO_AUTO_CONFIRM_NATIVE_SIGNUP")) {
      event.response.autoConfirmUser = true;
    }

    if (readBooleanEnv("COGNITO_AUTO_VERIFY_NATIVE_EMAIL")) {
      event.response.autoVerifyEmail = true;
    }
  }

  return event;
}
