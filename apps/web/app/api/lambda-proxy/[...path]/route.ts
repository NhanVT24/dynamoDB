import crypto from "node:crypto";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function getOrCreateCorrelationId(request: Request) {
  return request.headers.get("x-correlation-id") || request.headers.get("x-request-id") || crypto.randomUUID();
}

const upstreamBaseUrl = (
  process.env.API_BASE_URL ??
  process.env.LOCALSTACK_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.LOCALSTACK_LAMBDA_URL ??
  ""
).replace(/\/$/, "");

function buildTargetUrl(pathSegments: string[] | undefined, requestUrl: string) {
  if (!upstreamBaseUrl) {
    throw new Error("LOCALSTACK_API_URL is not configured");
  }

  const incomingUrl = new URL(requestUrl);
  const joinedPath = Array.isArray(pathSegments) ? pathSegments.join("/") : "";
  const targetUrl = new URL(`${upstreamBaseUrl}/${joinedPath}`);
  targetUrl.search = incomingUrl.search;
  return targetUrl;
}

async function proxy(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const targetUrl = buildTargetUrl(params?.path, request.url);
    const correlationId = getOrCreateCorrelationId(request);
    console.log("[lambda-proxy] forwarding", {
      correlationId,
      method: request.method,
      path: params?.path ?? [],
      targetUrl: targetUrl.toString()
    });
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    const authorization = request.headers.get("authorization");
    const requestId = request.headers.get("x-request-id");

    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (authorization) headers.set("authorization", authorization);
    headers.set("x-correlation-id", correlationId);
    if (requestId) headers.set("x-request-id", requestId);

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual"
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);
    console.log("[lambda-proxy] upstream response", {
      correlationId,
      method: request.method,
      targetUrl: targetUrl.toString(),
      status: response.status,
      statusText: response.statusText
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("x-correlation-id", response.headers.get("x-correlation-id") || correlationId);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Correlation-Id, X-Request-Id");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("[lambda-proxy] request failed", error);
    return Response.json(
      { message: error instanceof Error ? error.message : "Proxy request failed" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id, X-Request-Id"
        }
      }
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id, X-Request-Id"
    }
  });
}
