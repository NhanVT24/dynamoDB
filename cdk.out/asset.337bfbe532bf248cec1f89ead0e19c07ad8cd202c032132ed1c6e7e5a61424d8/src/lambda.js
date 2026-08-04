import awsLambdaFastify from "@fastify/aws-lambda";
import { buildApp } from "./app.js";
const app = await buildApp();
const proxy = awsLambdaFastify(app, {
    pathParameterUsedAsPath: "proxy"
});
await app.ready();
export const handler = async (event, context) => proxy(event, context);
