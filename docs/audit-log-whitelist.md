# Audit log whitelist

Audit log is a separate DynamoDB table named `supermarket-audit-log`. The generic item shape is:

```json
{
  "PK": "AUDIT_LOG#ORDER#order-123",
  "SK": "EVENT#2026-09-29T02:20:55.000Z#stream-event-id",
  "entityType": "AUDIT_LOG",
  "resourceType": "ORDER",
  "resourceId": "order-123",
  "action": "UPDATED",
  "eventName": "MODIFY",
  "changes": {
    "status": { "before": "awaiting_payment", "after": "paid" }
  },
  "actor": { "type": "SERVICE", "id": "lambda:vnpay-ipn", "role": "SYSTEM" },
  "context": { "source": "VNPAY_IPN", "reason": "payment_success", "requestId": "order-123" }
}
```

## Current whitelist

| Resource | Fields stored in `changes` | Reason |
| --- | --- | --- |
| `ORDER` | `status` | Tracks checkout, payment, refund, expiry lifecycle without copying customer/order PII. |
| `PAYMENT` | `status` | Tracks payment session lifecycle and can link back to parent order. |
| `USER` profile | `displayName`, `avatarKey`, `status` | Tracks safe account profile and status changes. |
| `USER` authorization | `permissions` | Tracks delegated permission set changes. |

## Future whitelist

| Resource | Recommended fields | Avoid |
| --- | --- | --- |
| `PRODUCT` | `name`, `price`, `stock`, `status`, `categoryId` | long descriptions, image blobs, internal computed fields. |
| `INVENTORY` | `stock`, `reservedStock`, `soldCount`, `status` | full product snapshot. |
| `REFUND` | `status`, `gatewayStatus`, `transactionNo` masked if needed | gateway secrets, full gateway payload. |

## Denylist

Never store these fields directly in audit `changes`:

- `password`, `passwordHash`
- `refreshToken`, `accessToken`, `idToken`
- `otpSecret`, `secret`, `hash`
- raw `customerEmail`, `email`, `phone`, `address` unless masked
- large blobs or full third-party gateway payloads

The audit worker compares only whitelisted fields after EventBridge Pipe sends the DynamoDB Stream record to SQS. The Stream record contains `OldImage` and `NewImage`; the worker computes the diff before writing the audit table.

For each whitelisted field, the worker first classifies the DynamoDB attribute by type, then compares the classified values with a recursive deep comparison. `S`, `N`, `BOOL` and `NULL` compare by type and value. `M` compares nested keys without depending on key order. `L` compares elements in order. `SS` and `NS` become JavaScript `Set` values, so member order does not matter. A missing attribute differs from DynamoDB `NULL`. Unsupported types and nesting deeper than 32 levels fail the message so it can be investigated through the worker DLQ.

The stored `changes.before` and `changes.after` remain `string | null` for compatibility with existing audit records. Strings are stored directly, string sets keep their sorted JSON array string format, and other types use a canonical type-tagged JSON string. Whitelisting a map stores that entire map in the audit record; review nested fields for sensitive data before adding such a field.

