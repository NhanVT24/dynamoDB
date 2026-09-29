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

## Future whitelist

| Resource | Recommended fields | Avoid |
| --- | --- | --- |
| `USER` | `email` masked, `displayName`, `role`, `status`, `permissions` | password hash, tokens, OTP secret, raw phone/address unless masked. |
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

The Stream consumer should compare only whitelisted fields. DynamoDB Stream gives `OldImage` and `NewImage`; the audit code computes the diff itself.

