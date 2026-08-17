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
    event.requestContext = {
      ...(event?.requestContext ?? {}),
      lambdaName: config.lambdaName
    };

    const proxy = await proxyPromise;
    return proxy(event, context);
  };
}
