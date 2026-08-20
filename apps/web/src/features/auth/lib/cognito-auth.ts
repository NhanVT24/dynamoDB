"use client";

import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand
} from "@aws-sdk/client-cognito-identity-provider";

export type AuthSession = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  email: string;
  name: string;
  role: "admin" | "customer" | "viewer";
};

type JwtPayload = {
  email?: string;
  name?: string;
  display_name?: string;
  role?: string;
  auth_provider?: string;
  principal_email?: string;
  "cognito:groups"?: string[];
};

type CognitoErrorLike = {
  name?: string;
  message?: string;
};

const sessionStorageKey = "cognito-auth-session";
const postLoginRedirectStorageKey = "cognito-post-login-redirect";
export const authSessionChangedEvent = "cognito-auth-session-changed";

function clearPostLoginRedirect() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(postLoginRedirectStorageKey);
}

function dispatchAuthSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(authSessionChangedEvent));
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
    throw new Error("Cognito Client ID đang là placeholder. Hãy cập nhật apps/web/.env.local bằng UserPoolClientId thật từ AWS.");
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
    throw new Error("Cognito domain không hợp lệ. Hãy cập nhật apps/web/.env.local bằng CognitoHostedUiDomain thật từ AWS.");
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
  const [, payload = ""] = token.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(atob(padded)) as T;
}

function mapCognitoError(target: string, error: CognitoErrorLike) {
  const rawType = String(error.name || "").trim();
  const rawMessage = String(error.message || "").trim();

  if (rawType === "UsernameExistsException") {
    return "Email đã được sử dụng.";
  }

  if (rawType === "UserNotFoundException") {
    return "Không tìm thấy tài khoản với email này.";
  }

  if (rawType === "UserNotConfirmedException") {
    return "Tài khoản chưa xác nhận email. Hãy nhập mã xác nhận trước.";
  }

  if (rawType === "CodeMismatchException") {
    return "Mã xác nhận không đúng.";
  }

  if (rawType === "ExpiredCodeException") {
    return "Mã xác nhận đã hết hạn. Hãy gửi lại mã mới.";
  }

  if (rawType === "AliasExistsException") {
    return "Email này đã được gắn với một tài khoản khác.";
  }

  if (rawType === "LimitExceededException" || rawType === "TooManyRequestsException") {
    return "Bạn thao tác quá nhanh. Hãy thử lại sau vài phút.";
  }

  if (rawType === "PasswordHistoryPolicyViolationException") {
    return "Mật khẩu mới không được trùng với mật khẩu cũ.";
  }

  if (rawType === "InvalidPasswordException") {
    return "Mật khẩu chưa đúng policy. Cần ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.";
  }

  if (rawType === "NotAuthorizedException") {
    if (target === "InitiateAuth") {
      return "Email hoặc mật khẩu không chính xác. Hãy kiểm tra lại thông tin đăng nhập.";
    }

    if (target === "ConfirmForgotPassword") {
      return rawMessage || "Không thể đặt lại mật khẩu với thông tin hiện tại.";
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
    if (!session.accessToken || !session.idToken || Date.now() >= session.expiresAt) {
      window.localStorage.removeItem(sessionStorageKey);
      return null;
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

export function clearAuthSession() {
  window.localStorage.removeItem(sessionStorageKey);
  dispatchAuthSessionChanged();
}

export function signOutLocally() {
  clearPostLoginRedirect();
  clearAuthSession();
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
  url.searchParams.set("scope", "openid email profile");
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
    throw new Error(payload?.error_description || payload?.error || "Không thể đăng nhập bằng Google qua Cognito.");
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

export function resolvePostLoginRoute(session: Pick<AuthSession, "role">, redirectPath?: string | null) {
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
}) {
  if (!authenticationResult.AccessToken || !authenticationResult.IdToken || !authenticationResult.ExpiresIn) {
    throw new Error("Missing authentication result from Cognito");
  }

  const idPayload = decodeJwtPayload<JwtPayload>(authenticationResult.IdToken);

  const session: AuthSession = {
    accessToken: authenticationResult.AccessToken,
    idToken: authenticationResult.IdToken,
    refreshToken: authenticationResult.RefreshToken,
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
            : "viewer"
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
