import { Injectable } from "@nestjs/common";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { env } from "../../config/env.js";
import { getAuditLog, getAuditOrderEmails, listAuditLogs } from "./audit-log.repository.js";
import type { AuditLogRecord } from "./audit-log.js";

const cognito = new CognitoIdentityProviderClient({ region: env.AWS_REGION });

@Injectable()
export class AuditLogService {
  async list(input: { resourceType?: unknown; limit?: unknown; cursor?: unknown }) {
    const page = await listAuditLogs(input);
    return { ...page, items: await this.enrich(page.items) };
  }

  async detail(input: { pk?: unknown; sk?: unknown }) {
    const item = await getAuditLog(input);
    return (await this.enrich([item]))[0];
  }

  private async enrich(items: AuditLogRecord[]) {
    const subjects = new Set<string>();
    const orderIds = new Set<string>();
    for (const item of items) {
      if (item.resourceType === "USER") subjects.add(item.resourceId);
      if (item.actor.type === "USER" || item.actor.type === "ADMIN") subjects.add(item.actor.id);
      const orderId = item.resourceType === "ORDER" ? item.resourceId : item.parentResourceId;
      if (orderId) orderIds.add(orderId);
    }
    const [users, orders] = await Promise.all([
      Promise.all([...subjects].map(async (subject) => {
        if (!env.COGNITO_USER_POOL_ID) return [subject, undefined] as const;
        const result = await cognito.send(new ListUsersCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Filter: `sub = ${JSON.stringify(subject)}`,
          Limit: 1
        }));
        return [subject, result.Users?.[0]?.Attributes?.find((attribute) => attribute.Name === "email")?.Value] as const;
      })),
      getAuditOrderEmails([...orderIds])
    ]);
    const emails = new Map(users);
    return items.map((item) => ({
      ...item,
      ownerEmail: item.resourceType === "USER" ? emails.get(item.resourceId) : orders.get(item.resourceType === "ORDER" ? item.resourceId : item.parentResourceId ?? ""),
      actor: { ...item.actor, email: emails.get(item.actor.id) }
    }));
  }
}
