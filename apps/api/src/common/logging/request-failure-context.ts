/** Never log bodies, query strings, raw errors, messages or stacks here:
 * provider errors and validation payloads can contain signed URLs or credentials.
 * The matched route is a template (e.g. /orders/:id), not the caller's raw URL.
 */
export function requestFailureContext(exception: unknown, request: {
  correlationId?: string; method?: string; routeOptions?: { url?: string };
}) {
  return {
    correlationId: String(request?.correlationId ?? "").slice(0, 128),
    errorName: exception instanceof Error ? exception.name : "UnknownError",
    method: request?.method,
    route: request?.routeOptions?.url ?? "<unmatched>"
  };
}
