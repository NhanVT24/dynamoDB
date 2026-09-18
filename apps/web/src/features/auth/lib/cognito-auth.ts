"use client";

import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GetTokensFromRefreshTokenCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { jwtDecode } from "jwt-decode";

export type ProductPermission = "products:create" | "products:update-own" | "products:delete-own";

export type AuthSession = {
  subject?: string;
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  // Cognito doesn't include a refresh-token expiry in the authentication
  // response. This is client-side metadata matching the app-client policy.
  refreshExpiresAt?: number;
  expiresAt: number;
  email: string;
  name: string;
  role: "admin" | "customer" | "viewer";
  accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED";
  permissions: ProductPermission[];
};

type JwtPayload = {
  sub?: string;
  email?: string;
  name?: string;
  display_name?: string;
  role?: string;
  account_status?: string;
  auth_provider?: string;
  principal_email?: string;
  "cognito:groups"?: string[];
  permissions?: unknown;
};

type CognitoErrorLike = {
  name?: string;
  message?: string;
};

const sessionStorageKey = "cognito-auth-session";
const postLoginRedirectStorageKey = "cognito-post-login-redirect";
const accessTokenRefreshLeewayMs = 10_000;
// Keep this aligned with the UserPoolClient configuration in infra/aws-api-stack.ts.
// Seven days is the maximum idle-session window; refresh-token rotation renews
// it for an actively used session.
const refreshTokenValidityMs = 7 * 24 * 60 * 60 * 1000;
let refreshInFlight: Promise<AuthSession | null> | undefined;
export const authSessionChangedEvent = "cognito-auth-session-changed";
export const authSessionEndedEvent = "cognito-auth-session-ended";

type AuthSessionEndedReason = "account_blocked" | "refresh_expired";

function clearPostLoginRedirect() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(postLoginRedirectStorageKey);
}

function dispatchAuthSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(authSessionChangedEvent));
}

function dispatchAuthSessionEnded(reason: AuthSessionEndedReason, message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(authSessionEndedEvent, {
    detail: { reason, message }
  }));
}

function repairMojibake(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  // Repair common UTF-8 text that was previously decoded as Latin-1/Windows-1252.
  if (/[ÃƒÆ’Ãƒâ€žÃƒâ€šÃƒÂ¡Ã‚ÂºÃƒÂ¡Ã‚Â»]/.test(text)) {
    try {
      const repaired = decodeURIComponent(escape(text));
      if (repaired) {
        return repaired;
      }
    } catch {
      return text;
    }
  }

  return text;
}

function getRequiredEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing ${name} in apps/web/.env.local`);
  }

  return value;
}

function getCognitoRegion() {
  return getRequiredEnv("NEXT_PUBLIC_AWS_REGION", process.env.NEXT_PUBLIC_AWS_REGION);
}

function getCognitoClientId() {
  const value = getRequiredEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID);
  if (value.includes("your-cognito-client-id") || value.includes("replace-me")) {
    throw new Error("Cognito Client ID is not set. Please update apps/web/.env.local with your actual Cognito Client ID from AWS.");
  }

  return value;
}

function getCognitoDomain() {
  const value = getRequiredEnv("NEXT_PUBLIC_COGNITO_DOMAIN", process.env.NEXT_PUBLIC_COGNITO_DOMAIN);
  const normalized = value.replace(/\/+$/, "");

  try {
    const url = new URL(normalized);
    const isAwsCognitoHost = /\.auth\.[a-z0-9-]+\.amazoncognito\.com$/i.test(url.hostname);
    const isExampleValue = /your-cognito-domain/i.test(normalized);

    if (!isAwsCognitoHost || isExampleValue) {
      throw new Error("invalid");
    }
  } catch {
    throw new Error("Cognito domain is not valid. Please update apps/web/.env.local with your actual Cognito Hosted UI Domain from AWS.");
  }

  return normalized;
}

function getRedirectUri() {
  if (typeof window === "undefined") {
    return "http://localhost:3000/auth/callback";
  }

  return `${window.location.origin}/auth/callback`;
}

function getCognitoClient() {
  return new CognitoIdentityProviderClient({
    region: getCognitoRegion()
  });
}

function decodeJwtPayload<T>(token: string): T {
  return jwtDecode<T>(token);
}

function readPermissions(value: unknown): ProductPermission[] {
  const supported = new Set<ProductPermission>([
    "products:create",
    "products:update-own",
    "products:delete-own"
  ]);
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is ProductPermission => typeof item === "string" && supported.has(item as ProductPermission)))]
    : [];
}

function readAccountStatus(value: unknown): AuthSession["accountStatus"] {
  const status = String(value || "ACTIVE").trim().toUpperCase();
  return status === "SUSPENDED" || status === "DISABLED" || status === "BLOCKED" ? status : "ACTIVE";
}

function mapCognitoError(target: string, error: CognitoErrorLike) {
  const rawType = String(error.name || "").trim();
  const rawMessage = String(error.message || "").trim();

  if (rawType === "UsernameExistsException") {
    return "Email has already been used.";
  }

  if (rawType === "UserNotFoundException") {
    return "No account found with this email.";
  }

  if (rawType === "UserNotConfirmedException") {
    return "Account not confirmed. Please enter confirmation code.";
  }

  if (rawType === "CodeMismatchException") {
    return "Confirmation code is incorrect.";
  }

  if (rawType === "ExpiredCodeException") {
    return "Confirmation code has expired. Please request a new one.";
  }

  if (rawType === "AliasExistsException") {
    return "This email is already associated with another account.";
  }

  if (rawType === "LimitExceededException" || rawType === "TooManyRequestsException") {
    return "You are making too many requests. Please try again in a few minutes.";
  }

  if (rawType === "PasswordHistoryPolicyViolationException") {
    return "The new password cannot be the same as the previous password.";
  }

  if (rawType === "InvalidPasswordException") {
    return "The new password does not meet the policy requirements. It must be at least 8 characters long and include uppercase, lowercase, and numeric characters.";
  }

  if (rawType === "NotAuthorizedException") {
    if (target === "InitiateAuth") {
      return "Email or password is incorrect. Please check your login information.";
    }

    if (target === "ConfirmForgotPassword") {
      return rawMessage || "Cannot reset password with current information.";
    }
  }

  if (rawMessage) {
    return rawMessage;
  }

  if (rawType) {
    return rawType;
  }

  return `Cognito request failed: ${target}`;
}

async function sendCognitoCommand<T>(target: string, _command: { input: unknown }, send: () => Promise<T>) {
  try {
    return await send();
  } catch (error) {
    const cognitoError = error as CognitoErrorLike;
    throw new Error(mapCognitoError(target, cognitoError));
  }
}

export function readAuthSession() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(sessionStorageKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken || !session.idToken) {
      window.localStorage.removeItem(sessionStorageKey);
      return null;
    }
    // The access token is the source of truth. A cached `permissions: []` from
    // an older token must not hide permissions added by the pre-token trigger.
    const accessPayload = decodeJwtPayload<JwtPayload>(session.accessToken);
    session.permissions = readPermissions(accessPayload.permissions);
    session.accountStatus = readAccountStatus(accessPayload.account_status);

    if (session.refreshExpiresAt && Date.now() >= session.refreshExpiresAt) {
      window.localStorage.removeItem(sessionStorageKey);
      return null;
    }

    if (Date.now() >= session.expiresAt) {
      // The synchronous API cannot return a refreshed session. Start a
      // best-effort refresh; callers should use getValidAuthSession before an
      // authenticated request when they require a token immediately.
      void refreshAuthSession();
      return null;
    }

    // Sessions created before user-scoped cart storage did not persist `sub`.
    // Repair them from the signed ID token so their cart namespace stays
    // stable across a token refresh.
    if (!session.subject) {
      const subject = String(decodeJwtPayload<JwtPayload>(session.idToken).sub ?? "").trim();
      if (subject) {
        session.subject = subject;
        window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
      }
    }

    return session;
  } catch {
    window.localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

export function persistAuthSession(session: AuthSession) {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  dispatchAuthSessionChanged();
}

export function clearAuthSession(options?: { notify?: boolean }) {
  window.localStorage.removeItem(sessionStorageKey);
  if (options?.notify !== false) {
    dispatchAuthSessionChanged();
  }
}

function readStoredSession() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(sessionStorageKey);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    const accessPayload = decodeJwtPayload<JwtPayload>(session.accessToken);
    session.permissions = readPermissions(accessPayload.permissions);
    session.accountStatus = readAccountStatus(accessPayload.account_status);
    return session;
  } catch {
    window.localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

function shouldRefresh(session: AuthSession) {
  return Date.now() >= session.expiresAt - accessTokenRefreshLeewayMs;
}

function isInvalidRefreshTokenError(error: unknown) {
  const name = String((error as CognitoErrorLike | undefined)?.name ?? "");
  return ["NotAuthorizedException", "InvalidParameterException", "ForbiddenException"].includes(name);
}

function isBlockedAccountRefreshError(error: unknown) {
  const message = String((error as CognitoErrorLike | undefined)?.message ?? "").toLowerCase();
  return message.includes("not allowed to receive new tokens") ||
    message.includes("not allowed to sign in") ||
    message.includes("account is not allowed") ||
    message.includes("pretokengeneration failed") ||
    message.includes("preauthentication failed");
}

/**
 * Exchanges a still-valid Cognito refresh token for new access and ID tokens.
 * With refresh-token rotation enabled, Cognito also returns a new refresh
 * token. An expired/revoked refresh token cannot be renewed silently: the user
 * must authenticate again.
 */
export async function refreshAuthSession(): Promise<AuthSession | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const current = readStoredSession();
    if (!current?.refreshToken) return null;
    if (current.refreshExpiresAt && Date.now() >= current.refreshExpiresAt) {
      clearAuthSession();
      return null;
    }

    try {
      const client = getCognitoClient();
      const command = new GetTokensFromRefreshTokenCommand({
        ClientId: getCognitoClientId(),
        RefreshToken: current.refreshToken
      });
      const result = await client.send(command);
      return buildSession(result.AuthenticationResult ?? {}, current);
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        clearAuthSession();
        if (isBlockedAccountRefreshError(error)) {
          dispatchAuthSessionEnded(
            "account_blocked",
            "Your account is currently blocked or disabled. Please contact support."
          );
        }
        return null;
      }
      // A network/5xx failure must not log a user out. A later authenticated
      // request can retry while the refresh token remains valid.
      console.warn("Unable to refresh Cognito session; will retry.", error);
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

/** Returns a usable session, refreshing it first when the access token is near expiry. */
export async function getValidAuthSession(): Promise<AuthSession | null> {
  const session = readStoredSession();
  if (!session) return null;
  if (session.refreshExpiresAt && Date.now() >= session.refreshExpiresAt) {
    clearAuthSession();
    return null;
  }
  if (shouldRefresh(session) || Date.now() >= session.expiresAt) {
    return refreshAuthSession();
  }
  return session;
}

/**
 * Fetches an authenticated API endpoint with a freshly validated ID token.
 * Keep browser callers behind this helper so an expired token is never sent
 * merely because a React component still holds an older session snapshot.
 */
export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const session = await getValidAuthSession();
  if (!session?.accessToken) throw new Error("Your session has expired. Please sign in again.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  return fetch(input, { ...init, headers });
}

export function signOutLocally(options?: { notify?: boolean }) {
  clearPostLoginRedirect();
  clearAuthSession(options);
}

export function rememberPostLoginRedirect(path: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(postLoginRedirectStorageKey, path);
}

export function consumePostLoginRedirect() {
  if (typeof window === "undefined") return null;

  const nextPath = window.localStorage.getItem(postLoginRedirectStorageKey);
  if (!nextPath) {
    return null;
  }

  window.localStorage.removeItem(postLoginRedirectStorageKey);
  return nextPath;
}

export function beginGoogleSignIn() {
  const url = new URL(`${getCognitoDomain()}/oauth2/authorize`);
  url.searchParams.set("identity_provider", "Google");
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", getCognitoClientId());
  url.searchParams.set("scope", "openid email profile supermarket-api/access");
  window.location.assign(url.toString());
}

export async function exchangeAuthorizationCodeForSession(code: string) {
  const response = await fetch(`${getCognitoDomain()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: getCognitoClientId(),
      code,
      redirect_uri: getRedirectUri()
    }).toString()
  });

  const payload = await response.json().catch(() => null) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !payload?.access_token || !payload?.id_token || !payload?.expires_in) {
    throw new Error(payload?.error_description || payload?.error || "Cannot sign in with Google through Cognito.");
  }

  return buildSession({
    AccessToken: payload.access_token,
    IdToken: payload.id_token,
    RefreshToken: payload.refresh_token,
    ExpiresIn: payload.expires_in
  });
}

export function signOutFromCognitoHostedUi() {
  clearPostLoginRedirect();
  clearAuthSession();

  const url = new URL(`${getCognitoDomain()}/logout`);
  url.searchParams.set("client_id", getCognitoClientId());
  url.searchParams.set("logout_uri", typeof window === "undefined" ? "http://localhost:3000/" : `${window.location.origin}/`);
  window.location.assign(url.toString());
}

export function resolvePostLoginRoute(session: Pick<AuthSession, "role" | "permissions">, redirectPath?: string | null) {
  const normalizedRedirect = String(redirectPath ?? "").trim();

  if (session.role === "admin") {
    return normalizedRedirect.startsWith("/admin") ? normalizedRedirect : "/admin";
  }

  if (normalizedRedirect && !normalizedRedirect.startsWith("/admin")) {
    return normalizedRedirect;
  }

  return "/store";
}

function buildSession(authenticationResult: {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}, previousSession?: AuthSession) {
  if (!authenticationResult.AccessToken || !authenticationResult.IdToken || !authenticationResult.ExpiresIn) {
    throw new Error("Missing authentication result from Cognito");
  }

  const idPayload = decodeJwtPayload<JwtPayload>(authenticationResult.IdToken);
  const accessPayload = decodeJwtPayload<JwtPayload>(authenticationResult.AccessToken);

  const session: AuthSession = {
    subject: String(idPayload.sub ?? "").trim() || undefined,
    accessToken: authenticationResult.AccessToken,
    idToken: authenticationResult.IdToken,
    refreshToken: authenticationResult.RefreshToken ?? previousSession?.refreshToken,
    refreshExpiresAt: authenticationResult.RefreshToken
      ? Date.now() + refreshTokenValidityMs
      : previousSession?.refreshExpiresAt,
    expiresAt: Date.now() + authenticationResult.ExpiresIn * 1000,
    email: repairMojibake(idPayload.principal_email) || repairMojibake(idPayload.email) || "unknown@example.com",
    name: repairMojibake(idPayload.display_name) || repairMojibake(idPayload.name) || repairMojibake(idPayload.email) || "Cognito User",
    role: String(idPayload.role || "").toLowerCase() === "admin"
      ? "admin"
      : String(idPayload.role || "").toLowerCase() === "customer"
        ? "customer"
        : idPayload["cognito:groups"]?.some((group) => String(group).toLowerCase() === "admin")
          ? "admin"
          : idPayload["cognito:groups"]?.some((group) => String(group).toLowerCase() === "customer")
            ? "customer"
            : "viewer",
    accountStatus: readAccountStatus(accessPayload.account_status || idPayload.account_status),
    permissions: readPermissions(accessPayload.permissions)
  };

  persistAuthSession(session);
  return session;
}

export async function signUpWithCognito(input: {
  email: string;
  password: string;
  name?: string;
}) {
  const client = getCognitoClient();
  const command = new SignUpCommand({
    ClientId: getCognitoClientId(),
    Username: input.email.trim().toLowerCase(),
    Password: input.password,
    UserAttributes: [
      { Name: "email", Value: input.email.trim().toLowerCase() },
      ...(input.name?.trim() ? [{ Name: "name", Value: input.name.trim() }] : [])
    ]
  });

  return sendCognitoCommand("SignUp", command, () => client.send(command));
}

export async function confirmSignUpWithCognito(input: {
  email: string;
  code: string;
}) {
  const client = getCognitoClient();
  const command = new ConfirmSignUpCommand({
    ClientId: getCognitoClientId(),
    Username: input.email.trim().toLowerCase(),
    ConfirmationCode: input.code.trim()
  });

  return sendCognitoCommand("ConfirmSignUp", command, () => client.send(command));
}

export async function resendConfirmationCode(email: string) {
  const client = getCognitoClient();
  const command = new ResendConfirmationCodeCommand({
    ClientId: getCognitoClientId(),
    Username: email.trim().toLowerCase()
  });

  return sendCognitoCommand("ResendConfirmationCode", command, () => client.send(command));
}

export async function signInWithCognito(input: {
  email: string;
  password: string;
}) {
  const client = getCognitoClient();
  const command = new InitiateAuthCommand({
    ClientId: getCognitoClientId(),
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: {
      USERNAME: input.email.trim().toLowerCase(),
      PASSWORD: input.password
    }
  });

  const result = await sendCognitoCommand("InitiateAuth", command, () => client.send(command));
  return buildSession(result.AuthenticationResult ?? {});
}

export async function forgotPassword(email: string) {
  const client = getCognitoClient();
  const command = new ForgotPasswordCommand({
    ClientId: getCognitoClientId(),
    Username: email.trim().toLowerCase()
  });

  return sendCognitoCommand("ForgotPassword", command, () => client.send(command));
}

export async function confirmForgotPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}) {
  const client = getCognitoClient();
  const command = new ConfirmForgotPasswordCommand({
    ClientId: getCognitoClientId(),
    Username: input.email.trim().toLowerCase(),
    ConfirmationCode: input.code.trim(),
    Password: input.newPassword
  });

  return sendCognitoCommand("ConfirmForgotPassword", command, () => client.send(command));
}
