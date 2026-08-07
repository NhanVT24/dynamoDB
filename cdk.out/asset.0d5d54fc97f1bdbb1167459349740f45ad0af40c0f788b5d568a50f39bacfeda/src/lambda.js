import "reflect-metadata";
import awsLambdaFastify from "@fastify/aws-lambda";
import { createNestApp } from "./app.js";
const app = await createNestApp();
const proxy = awsLambdaFastify(app.getHttpAdapter().getInstance(), {
    pathParameterUsedAsPath: "proxy"
});
export const handler = async (event, context) => {
    const pathParameters = typeof event?.pathParameters === "object" && event.pathParameters ? { ...event.pathParameters } : {};
    const rawProxyPath = typeof pathParameters.proxy === "string" ? pathParameters.proxy.replace(/^\/+/, "") : "";
    const path = String(event?.path ?? "");
    const rawPath = String(event?.rawPath ?? "");
    const storefrontPrefix = "/api/storefront";
    const isStorefrontRequest = path.includes(`${storefrontPrefix}/`) ||
        path.endsWith(storefrontPrefix) ||
        rawPath.startsWith(`${storefrontPrefix}/`) ||
        rawPath === storefrontPrefix;
    if (isStorefrontRequest) {
        pathParameters.proxy = rawProxyPath ? `api/storefront/${rawProxyPath}` : "api/storefront";
        event.pathParameters = pathParameters;
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
