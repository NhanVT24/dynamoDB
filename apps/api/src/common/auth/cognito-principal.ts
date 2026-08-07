type JwtPayload = {
  email?: string;
  principal_email?: string;
  role?: string;
  "cognito:groups"?: string | string[];
};

function decodeJwtPayload<T>(token: string): T | null {
  try {
    const [, payload = ""] = token.split(".");
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function toGroups(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return [];
}

export type CognitoPrincipal = {
  email: string;
  role: "admin" | "customer" | "viewer";
  groups: string[];
};

export function extractCognitoPrincipal(headers: Record<string, unknown>): CognitoPrincipal | null {
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  const payload = decodeJwtPayload<JwtPayload>(token);
  if (!payload) return null;

  const groups = toGroups(payload["cognito:groups"]);
  const role = String(payload.role || "").toLowerCase();
  const resolvedRole: CognitoPrincipal["role"] =
    role === "admin" || groups.includes("admin")
      ? "admin"
      : role === "customer" || groups.includes("customer")
        ? "customer"
        : "viewer";

  const email = String(payload.principal_email || payload.email || "").trim().toLowerCase();
  if (!email) return null;

  return { email, role: resolvedRole, groups };
}
