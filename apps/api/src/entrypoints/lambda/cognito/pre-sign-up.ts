import type { CognitoTriggerEvent } from "./types.js";
import { TriggerPreSignUp } from "./triggers/pre-sign-up.js";

export const handler = async (event: CognitoTriggerEvent) => {
  return TriggerPreSignUp(event);
};
