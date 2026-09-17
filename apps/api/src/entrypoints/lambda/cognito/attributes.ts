export type CognitoAttribute = {
  Name?: string;
  Value?: string;
};

export function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

export function getAttribute(attributes: CognitoAttribute[] | undefined, name: string) {
  return attributes?.find((attribute) => attribute.Name === name)?.Value ?? "";
}

export function parseProviderUserName(userName: unknown) {
  const [providerName, ...rest] = String(userName || "").split("_");
  return {
    providerName,
    providerUserId: rest.join("_")
  };
}

export function resolveAuthProvider(attributes: CognitoAttribute[] | undefined) {
  const identitiesRaw = getAttribute(attributes, "identities");
  if (!identitiesRaw) return "COGNITO";

  try {
    const identities = JSON.parse(identitiesRaw) as Array<{ providerName?: string }> | undefined;
    return String(identities?.[0]?.providerName || "COGNITO").toUpperCase();
  } catch {
    return "COGNITO";
  }
}
