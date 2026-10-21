import { ForbiddenException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal, hasPermission, type CognitoPrincipal } from "./cognito-principal.js";
import type { ProductPermission } from "./permissions.js";

type PrincipalRequest = Pick<FastifyRequest, "headers">;
// Cache belongs to the request object, never to the token or the whole process.
// The preHandler, audit interceptor and controller can share one verification.
const principals = new WeakMap<PrincipalRequest, Promise<CognitoPrincipal | null>>();

export function getRequestPrincipal(request: PrincipalRequest): Promise<CognitoPrincipal | null> {
  let result = principals.get(request);
  if (!result) {
    result = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    principals.set(request, result);
  }
  return result;
}

export async function requireRequestPrincipal(request: PrincipalRequest, options: {
  message: string;
  roles?: readonly CognitoPrincipal["role"][];
  permission?: ProductPermission;
}): Promise<CognitoPrincipal> {
  const principal = await getRequestPrincipal(request);
  if (!principal || (options.roles && !options.roles.includes(principal.role)) ||
    (options.permission && !hasPermission(principal, options.permission))) {
    throw new ForbiddenException(options.message);
  }
  return principal;
}
