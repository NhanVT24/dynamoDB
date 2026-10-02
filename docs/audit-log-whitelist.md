# Audit coverage and whitelist

The retained audit table is `supermarket-audit-log`. Source data flows through DynamoDB Streams, EventBridge Pipe, FIFO SQS and the audit worker. The worker persists only changed whitelisted fields; metadata-only changes and category-index items are ignored.

The authoritative registry is [audit-resources.ts](../apps/api/src/modules/audit-log/audit-resources.ts). API filters, pagination validation and worker validation use the same resource list.

| Resource | Audited changes |
| --- | --- |
| ORDER | Status, total amount, refund status/request, payment confirmation time. |
| PAYMENT | Status, amount, gateway response/status, bank code and paid time, including sessions without a parent order. |
| USER / PROFILE | Display name, avatar key, account status, saved ward/city/province locations, successful password reset time. |
| USER / AUTHORIZATION | Permission set; ordering-only differences are ignored. |
| PRODUCT | Every field accepted by the create/update schema, plus derived status; includes stock and sold count changes made by checkout workers. |
| SALE_CAMPAIGN | Name, status, discount, product selection, start/end times; includes Scheduler transitions and compensation after schedule creation fails. |
| NOTIFICATION | Channel, status, read flag, creation and deletion. Message text and recipient email are excluded. |
| CHECKOUT | Gate/reservation status, quantity, prices, failure code, order ID and hold deadline. Product reservations have a separate resource ID per checkout/product. |
| EMAIL | Email type, recipient count/type, submit/delivery status and status time, related/report IDs. Each recipient has a separate resource ID. |
| EMAIL_ROUTE | Route status/stage, alert status, publish attempts, manual retry count and next publish time. |
| OPERATION | Start/completion/failure of authenticated upload/report grants, admin queue/archive operations and email send/retry requests. Records method, route template and target ID, without copying request/response bodies. |

A single save produces one audit event per changed source item. Updating display name and avatar together remains one USER event with two change keys. Inventory updates on several products and permission/profile writes on separate items produce separate resource events.

## Actor attribution

A global Nest interceptor establishes an AsyncLocalStorage context using a verified Cognito principal and a server-generated request ID. DynamoDB initialize middleware stamps authoritative Put/Update/TransactWrite operations in the same write as the business change. Contexts remain isolated across concurrent requests. Index copies are excluded.

Background jobs preserve explicit repository actor/source metadata, or use the Lambda function name as a SERVICE actor. The Cognito trigger client uses the same stamping middleware. Password reset completion is handled by PostConfirmation_ConfirmForgotPassword and stores only passwordResetAt; no password or verification code is stored. Repeated trigger invocations may update that timestamp again; worker idempotency deduplicates delivery of the same event, not separate successful writes.

Missing actor metadata is displayed as unknown. A raw REMOVE never inherits the last editor's identity. Direct writes using a different DynamoDB client still produce a diff through Streams, but must supply their own actor metadata. Application audit covers the implemented application flows; direct AWS console changes and Cognito actions without an application trigger require separate provider auditing.

## Deletion consistency

Product and notification deletion first conditionally marks the source item with auditDeleteOutbox. This metadata-only write generates no business audit. The subsequent transaction combines a conditional Delete and an AUDIT_EVENT outbox Put (plus product category-index cleanup). Product deletes check version and owner; notification/cleanup deletes compare every whitelisted field, version and updatedAt. Scheduled cleanup also skips candidates whose updatedAt changed since selection. If the snapshot is stale or the transaction fails, neither the delete nor its audit outbox commits.

The marker suppresses the raw Stream REMOVE. The outbox contains only a compact, whitelisted DELETED record with the deleting actor. Its source type is APPLICATION_EVENT and it has an application event ID, not a fabricated DynamoDB sequence number. The worker reads the outbox INSERT and uses the existing conditional audit Put for duplicate delivery protection. A failed delete can leave the metadata marker behind; supported deletion retries still create an outbox. Administrative raw deletes of marked items must use this deletion flow to preserve their audit.

Scheduled cleanup uses the same deletion outbox for supported resources with concurrency bounded to ten items. These per-item reads/transactions cost more than BatchWrite deletes; verify cleanup throughput against the existing Lambda time budget before increasing volume.

Bulk notification deletion uses the same transaction per item. Failure is surfaced; successful earlier items remain deleted and audited. Retrying skips missing items. This replaces BatchWrite deletion that previously ignored UnprocessedItems.

## Retention and failures

Audit records remain retained. Source outboxes and operation ledgers use auditExpiresAt TTL after 90 days; expiry does not generate another business event. Resolve/replay failed ingestion within this source retention period. The Pipe and worker retain their existing retry, DLQ and alarm handling.

External operations write a started ledger before calling the handler. If this initial write fails, the handler does not run. completed means the API handler completed, not that an asynchronous email was delivered or an S3 object was uploaded; those outcomes are represented by their own source records. A crash or completion-write failure can leave started, so reconcile downstream state before retrying an external side effect.

Strings stay direct strings, numbers preserve their DynamoDB decimal text as JSON strings for compatibility and type distinction, sets use sorted JSON arrays and nested values use canonical JSON. Maps compare without depending on key order; lists compare in order; sets compare membership. Missing attributes differ from NULL.

## Sensitive data

Never persist password/passwordHash, tokens, OTP/secret material, raw recipient/customer emails, phone numbers, signed upload/payment URLs, email bodies, notification messages or gateway payloads in changes. Saved profile locations contain only the already supported ward/city/province fields. Adding nested whitelisted fields requires reviewing their contents.

The Pipe transports raw OldImage/NewImage records before the worker applies this whitelist, so main-queue/DLQ access remains privileged. Whitelisting controls the retained audit record, not the temporary Stream/SQS payload.

## Release validation

Deploy the updated API/Cognito code, audit worker and Pipe filters together with source-table TTL configuration, then publish the static frontend and invalidate CloudFront. Validate actual writes, deletes, actor attribution and replay in AWS. Local tests/builds alone do not establish live coverage. Historical changes before deployment cannot be reconstructed with verified actors.
