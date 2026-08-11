import "reflect-metadata";
import awsLambdaFastify from "@fastify/aws-lambda";
import { createNestApp } from "./app.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";

const app = await createNestApp();
const proxy = awsLambdaFastify(app.getHttpAdapter().getInstance(), {
  pathParameterUsedAsPath: "proxy"
});
const notificationsService = app.get(NotificationsService);

export const handler = async (event: any, context: unknown) => {
  if (Array.isArray(event?.Records) && event.Records.every((record: any) => record?.eventSource === "aws:sqs")) {
    const result = await notificationsService.processQueueRecords(event.Records);
    console.log("[lambda] processed sqs event", {
      recordCount: event.Records.length,
      processed: result?.processed ?? 0,
      items: result?.items ?? []
    });
    return result;
  }

  const pathParameters = typeof event?.pathParameters === "object" && event.pathParameters ? { ...event.pathParameters } : {};
  const rawProxyPath = typeof pathParameters.proxy === "string" ? pathParameters.proxy.replace(/^\/+/, "") : "";
  const path = String(event?.path ?? "");
  const rawPath = String(event?.rawPath ?? "");
  const rewritablePrefixes = [
    "/api/storefront",
    "/api/products",
    "/api/payments/vnpay",
    "/api/notifications"
  ];

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
    pathParameters.proxy = rawProxyPath ? `${normalizedPrefix}/${rawProxyPath}` : normalizedPrefix;
    event.pathParameters = pathParameters;
    break;
  }

  console.log("[lambda] incoming event", {
    path: event?.path,
    rawPath: event?.rawPath,
    httpMethod: event?.httpMethod,
    routeKey: event?.routeKey,
    stage: event?.requestContext?.stage,
    pathParameters: event?.pathParameters,
    queryStringParameters: event?.queryStringParameters
  });

  const response = await proxy(event, context);

  console.log("[lambda] outgoing response", {
    statusCode: response?.statusCode,
    headers: response?.headers
  });

  return response;
};
