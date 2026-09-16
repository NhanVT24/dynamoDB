import { extractCognitoPrincipal } from "./cognito-principal.js";

export async function extractCognitoGroups(headers: Record<string, unknown>) {
  return (await extractCognitoPrincipal(headers))?.groups ?? [];
}

export async function isAdminRequest(headers: Record<string, unknown>) {
  return (await extractCognitoPrincipal(headers))?.role === "admin";
}
