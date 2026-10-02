import type { PutItemCommandInput, UpdateItemCommandInput, TransactWriteItemsCommandInput } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { auditTarget } from "./audit-resources.js";
import { auditContext, currentAuditContext } from "./audit-context.js";

// Stamp metadata in the same write as business fields, including inventory updates
// inside checkout transactions. Only authoritative items are stamped, never indexes.
export function stampAuditWrite(commandName: string, input: unknown, tableName: string): void {
  function put(write: PutItemCommandInput) {
    if (write.TableName !== tableName || !auditTarget(write.Item?.PK?.S ?? "", write.Item?.SK?.S ?? "")) return;
    const metadata = marshall(currentAuditContext());
    // Authenticated requests win over legacy service metadata. Background jobs
    // retain their explicit source/reason where provided by the repository.
    write.Item = auditContext.getStore() ? { ...write.Item, ...metadata } : { ...metadata, ...write.Item };
  }
  function update(write: UpdateItemCommandInput) {
    if (write.TableName !== tableName || !auditTarget(write.Key?.PK?.S ?? "", write.Key?.SK?.S ?? "")) return;
    const names = write.ExpressionAttributeNames ??= {};
    const values = write.ExpressionAttributeValues ??= {};
    const setters: string[] = [];
    for (const [field, value] of Object.entries(currentAuditContext())) {
      const existingName = Object.entries(names).find(([, name]) => name === field)?.[0];
      const token = existingName ?? field;
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const existing = write.UpdateExpression?.match(new RegExp(`(?:^|[\\s,])${escapedToken}\\s*=\\s*(:[A-Za-z0-9_]+)`));
      if (existing) {
        if (auditContext.getStore()) values[existing[1]!] = { S: value };
        continue;
      }
      const alias = `#_audit_${field}`;
      const placeholder = `:_audit_${field}`;
      names[alias] = field;
      values[placeholder] = { S: value };
      setters.push(`${alias} = ${placeholder}`);
    }
    if (!setters.length) return;
    const expression = write.UpdateExpression ?? "";
    write.UpdateExpression = /\bSET\b/.test(expression)
      ? expression.replace(/\bSET\s+/, `SET ${setters.join(", ")}, `)
      : `SET ${setters.join(", ")} ${expression}`;
  }
  if (commandName === "PutItemCommand") put(input as PutItemCommandInput);
  if (commandName === "UpdateItemCommand") update(input as UpdateItemCommandInput);
  if (commandName === "TransactWriteItemsCommand") {
    for (const item of (input as TransactWriteItemsCommandInput).TransactItems ?? []) {
      if (item.Put) put(item.Put);
      if (item.Update) update(item.Update);
    }
  }
}
