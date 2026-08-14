import "reflect-metadata";
import awsLambdaFastify from "@fastify/aws-lambda";
import { createNestApp } from "./app.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { StorefrontService } from "./modules/storefront/storefront.service.js";

const app = await createNestApp();
const proxy = awsLambdaFastify(app.getHttpAdapter().getInstance(), {
  pathParameterUsedAsPath: "proxy"
});
const notificationsService = app.get(NotificationsService);
const storefrontService = app.get(StorefrontService);

export const handler = async (event: any, context: unknown) => {
  if (Array.isArray(event?.Records) && event.Records.every((record: any) => record?.eventSource === "aws:sqs")) {
    const firstPayload = (() => {
      try {
        return JSON.parse(String(event.Records[0]?.body ?? ""));
      } catch {
        return null;
      }
    })();
    const queueHandler = firstPayload?.type === "storefront.order.requested" ? storefrontService : notificationsService;
    const result = await queueHandler.processQueueRecords(event.Records);
    const batchItemFailures = Array.isArray(result?.failedMessageIds)
      ? result.failedMessageIds.map((messageId: string) => ({ itemIdentifier: messageId }))
      : [];

    console.log("[lambda-sqs] processed", {
      recordCount: event.Records.length,
      processed: result?.processed ?? 0,
      failed: batchItemFailures.length,
      items: result?.items ?? []
    });
    return { batchItemFailures };
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

  console.log("[lambda-http] incoming", {
    path: event?.path,
    rawPath: event?.rawPath,
    httpMethod: event?.httpMethod,
    routeKey: event?.routeKey,
    stage: event?.requestContext?.stage,
    pathParameters: event?.pathParameters,
    queryStringParameters: event?.queryStringParameters
  });

  const response = await proxy(event, context);

  console.log("[lambda-http] outgoing", {
    statusCode: response?.statusCode,
    headers: response?.headers
  });

  return response;
};
