import { AsyncLocalStorage } from "node:async_hooks";
import type { CognitoPrincipal } from "../../common/auth/cognito-principal.js";

export type AuditWriteContext = {
  auditActorType: "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
  auditActorId: string;
  auditActorRole: string;
  auditSource: string;
  auditReason: string;
  auditRequestId: string;
};
export const auditContext = new AsyncLocalStorage<AuditWriteContext>();

export function principalAuditContext(principal: CognitoPrincipal, requestId: string, source: string): AuditWriteContext {
  return { auditActorType: principal.role === "admin" ? "ADMIN" : "USER", auditActorId: principal.subject,
    auditActorRole: principal.role, auditSource: source, auditReason: "authenticated_mutation", auditRequestId: requestId };
}

export function serviceAuditContext(input: {
  actorId: string;
  source: string;
  reason: string;
  requestId?: string;
  actorType?: Extract<AuditWriteContext["auditActorType"], "SERVICE" | "SYSTEM">;
}): AuditWriteContext {
  return {
    auditActorType: input.actorType ?? "SERVICE",
    auditActorId: input.actorId,
    auditActorRole: "SYSTEM",
    auditSource: input.source,
    auditReason: input.reason,
    auditRequestId: input.requestId ?? ""
  };
}

// A service may supply a meaningful source at its entrypoint (webhook, queue,
// scheduler). Nested repositories always inherit it instead of inventing actor
// fields per DynamoDB command.
export function runWithAuditContext<T>(context: AuditWriteContext, work: () => T): T {
  return auditContext.run(context, work);
}

export function currentAuditContext(): AuditWriteContext {
  return auditContext.getStore() ?? {
    auditActorType: "SERVICE", auditActorId: process.env.AWS_LAMBDA_FUNCTION_NAME ?? "service:backend",
    auditActorRole: "SYSTEM", auditSource: process.env.AWS_LAMBDA_FUNCTION_NAME ?? "BACKEND",
    auditReason: "service_mutation", auditRequestId: ""
  };
}
