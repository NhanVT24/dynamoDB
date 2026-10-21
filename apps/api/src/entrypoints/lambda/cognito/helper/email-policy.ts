import { readCsvEnv } from "./env.js";
import { assertSignUpEmail } from "../../../../modules/customers/authorization/domain/sign-up-policy.js";
export function assertSignUpEmailAllowed(email:string){return assertSignUpEmail(email,{allowedDomains:readCsvEnv("COGNITO_SIGNUP_ALLOWED_EMAIL_DOMAINS"),blockedDomains:readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAIL_DOMAINS"),blockedEmails:readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAILS")});}
