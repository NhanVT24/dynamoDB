const upstreamBaseUrl = (
  process.env.LOCALSTACK_API_URL ??
  process.env.LOCALSTACK_LAMBDA_URL ??
  ""
).replace(/\/$/, "");

function buildTargetUrl(pathSegments, requestUrl) {
  if (!upstreamBaseUrl) {
    throw new Error("LOCALSTACK_API_URL is not configured");
  }

  const incomingUrl = new URL(requestUrl);
  const joinedPath = Array.isArray(pathSegments) ? pathSegments.join("/") : "";
  const targetUrl = new URL(`${upstreamBaseUrl}/${joinedPath}`);
  targetUrl.search = incomingUrl.search;
  return targetUrl;
}

async function proxy(request, context) {
  try {
    const params = await context.params;
    const targetUrl = buildTargetUrl(params?.path, request.url);
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");

    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);

    const init = {
      method: request.method,
      headers,
      redirect: "manual"
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Proxy request failed" },
      { status: 500 }
    );
  }
}

export async function GET(request, context) {
  return proxy(request, context);
}

export async function POST(request, context) {
  return proxy(request, context);
}

export async function PATCH(request, context) {
  return proxy(request, context);
}

export async function DELETE(request, context) {
  return proxy(request, context);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
