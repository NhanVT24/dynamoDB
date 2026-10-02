# DynamoDB Streams audit pipeline

The application writes compact change history to the retained `supermarket-audit-log` table.

`Source write -> DynamoDB Stream -> EventBridge Pipe -> FIFO SQS -> audit worker -> audit table`

See [audit-log-whitelist.md](audit-log-whitelist.md) for current resources, fields, deletion consistency, actor attribution, retention and limits. The authoritative key/field registry is `apps/api/src/modules/audit-log/audit-resources.ts`.

## Record identity

- `PK = AUDIT_LOG#<resourceType>#<resourceId>`
- `SK = EVENT#<occurredAt>#<eventId>`
- `action`: CREATED, UPDATED or DELETED.
- `changes`: map of whitelisted fields to before/after strings or null.
- `actor`: type, ID and optional role.
- `context`: source, reason, request ID and audit writer.
- `source`: source PK/SK, event ID and DynamoDB sequence number for Stream events.

Normal changes use source type DYNAMODB_STREAM. Audited deletion outboxes use APPLICATION_EVENT with a server-generated application event ID; no DynamoDB sequence number is fabricated. The outbox itself is delivered through Streams.

## Failures and replay

The Pipe forwards raw Stream records and retries delivery failures. Its DLQ is `supermarket-audit-log-pipe-dlq`. The worker computes the whitelist diff; unchanged fields and metadata-only writes are ignored. Failed writes retry through SQS and eventually reach `supermarket-audit-log-worker-dlq.fifo`.

The worker writes with `attribute_not_exists(PK) AND attribute_not_exists(SK)`. Replaying the same event cannot create a duplicate retained record. On FIFO batch failure, the worker returns the failed message and later messages for retry to preserve order. Distinct successful source writes are distinct events.

After fixing the underlying issue, replay valid worker-DLQ messages to AuditLogMainQueue through the Admin Ops UI. During migration, the worker also accepts compact legacy AUDIT_LOG queue messages. Source outboxes/operation ledgers expire after 90 days; retained audit records do not expire.

## Local validation

Run from the repository root:

~~~powershell
npm run typecheck --workspace apps/api
npx tsx apps/api/tests/audit-log.test.ts
npm run typecheck --workspace apps/web
npx tsc --noEmit -p infra/tsconfig.json
npm run cdk:aws:synth
~~~

The web typecheck script performs a production build/static export. Windows sandbox spawn EPERM can require running Next/esbuild outside the sandbox.

## Deployment order

Deploy compatible API/Cognito handlers and the audit worker before updating the Pipe filter. The source table also needs auditExpiresAt TTL configuration. Publish static frontend assets and invalidate CloudFront to expose the new resource filters.

Preserve the existing cross-stack audit queue URL export while deployed consumers still import it. A temporary old-publisher/new-Pipe overlap can enqueue the same Stream event twice; the worker's conditional writes protect retained records. Pipe starts at TRIM_HORIZON, so verify backfill and historical actor availability explicitly.

Check live Pipe state, queue delivery, worker execution, audit records, actor attribution and delete/replay behavior after deployment. Local builds and synth establish code/configuration validity; they do not prove live AWS coverage.
