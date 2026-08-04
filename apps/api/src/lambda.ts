import "reflect-metadata";
import awsLambdaFastify from "@fastify/aws-lambda";
import { createNestApp } from "./app.js";

const app = await createNestApp();
const proxy = awsLambdaFastify(app.getHttpAdapter().getInstance(), {
  pathParameterUsedAsPath: "proxy"
});

export const handler = async (event: any, context: unknown) => {
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
