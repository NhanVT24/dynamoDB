import { CognitoIdentityProviderClient, ListUsersCommand, type AttributeType } from "@aws-sdk/client-cognito-identity-provider";
import { env } from "../../config/env.js";

const cognito = new CognitoIdentityProviderClient({ region: env.AWS_REGION });

export type VerifiedCustomer = {
  email: string;
  displayName: string;
  emailVerified: true;
};

function attribute(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((item) => item.Name === name)?.Value?.trim() ?? "";
}

function escapeFilterValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Cognito is the source of truth for registered accounts. We query it directly
 * so a customer does not need an order or a separate DynamoDB profile to be
 * selectable as a campaign recipient.
 */
export async function listVerifiedCustomers(search = "", limit = 25): Promise<VerifiedCustomer[]> {
  if (!env.COGNITO_USER_POOL_ID) throw new Error("Missing COGNITO_USER_POOL_ID configuration.");
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 25;
  const normalizedSearch = search.trim();
  const filters = normalizedSearch
    ? [`email ^= "${escapeFilterValue(normalizedSearch)}"`, `name ^= "${escapeFilterValue(normalizedSearch)}"`]
    : [undefined];

  const pages = await Promise.all(filters.map((Filter) => cognito.send(new ListUsersCommand({
    UserPoolId: env.COGNITO_USER_POOL_ID,
    Filter,
    // Cognito can return unverified accounts too, so request a little extra
    // before filtering them out locally.
    Limit: Math.min(Math.max(safeLimit * 2, 25), 60)
  }))));

  const seen = new Set<string>();
  const customers: VerifiedCustomer[] = [];
  for (const user of pages.flatMap((page) => page.Users ?? [])) {
    const email = attribute(user.Attributes, "email").toLowerCase();
    const emailVerified = attribute(user.Attributes, "email_verified").toLowerCase() === "true";
    if (!user.Enabled || !email || !emailVerified || seen.has(email)) continue;
    seen.add(email);
    customers.push({
      email,
      displayName: attribute(user.Attributes, "name") || email,
      emailVerified: true
    });
    if (customers.length === safeLimit) break;
  }
  return customers;
}
