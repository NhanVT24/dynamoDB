import awsLambdaFastify from "@fastify/aws-lambda";
import { createNestApp } from "../../../core/app/create-app.js";

type HttpHandlerConfig = {
  lambdaName: string;
  rewritablePrefixes: string[];
};

function rewriteProxyPath(event: any, rewritablePrefixes: string[]) {
  const pathParameters = typeof event?.pathParameters === "object" && event.pathParameters ? { ...event.pathParameters } : {};
  const rawProxyPath = typeof pathParameters.proxy === "string" ? pathParameters.proxy.replace(/^\/+/, "") : "";
  const path = String(event?.path ?? "");
  const rawPath = String(event?.rawPath ?? "");

  for (const prefix of rewritablePrefixes) {
    const isMatchingRequest =
      path.includes(`${prefix}/`) ||
      path.endsWith(prefix) ||
      rawPath.startsWith(`${prefix}/`) ||
      rawPath === prefix;

    if (!isMatchingRequest) {
      continue;
    }

    const normalizedPrefix = prefix.replace(/^\/+/, "");
    const matchedPath = rawPath || path;
    const prefixSuffix = matchedPath.startsWith(prefix)
      ? matchedPath.slice(prefix.length).replace(/^\/+/, "")
      : "";
    const resolvedProxyPath = rawProxyPath || prefixSuffix;

    pathParameters.proxy = resolvedProxyPath
      ? `${normalizedPrefix}/${resolvedProxyPath}`
      : normalizedPrefix;
    event.pathParameters = pathParameters;
    break;
  }
}

export function createHttpHandler(config: HttpHandlerConfig) {
  const appPromise = createNestApp();
  const proxyPromise = appPromise.then((app) => awsLambdaFastify(app.getHttpAdapter().getInstance(), {
    pathParameterUsedAsPath: "proxy"
  }));

  return async (event: any, context: unknown) => {
    rewriteProxyPath(event, config.rewritablePrefixes);

    console.log(`[lambda-http:${config.lambdaName}] incoming`, {
      path: event?.path,
      rawPath: event?.rawPath,
      httpMethod: event?.httpMethod,
      routeKey: event?.routeKey,
      stage: event?.requestContext?.stage,
      pathParameters: event?.pathParameters,
      queryStringParameters: event?.queryStringParameters,
      hasBody: typeof event?.body === "string" ? event.body.length > 0 : Boolean(event?.body),
      bodyLength: typeof event?.body === "string" ? event.body.length : 0,
      isBase64Encoded: Boolean(event?.isBase64Encoded),
      contentType:
        event?.headers?.["content-type"] ??
        event?.headers?.["Content-Type"] ??
        null
    });

    const proxy = await proxyPromise;
    const response = await proxy(event, context);

    console.log(`[lambda-http:${config.lambdaName}] outgoing`, {
      statusCode: response?.statusCode,
      headers: response?.headers
    });

    return response;
  };
}
