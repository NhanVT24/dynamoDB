import "reflect-metadata";
import { createHttpHandler } from "./lambda/http-factory.js";

export const handler = createHttpHandler({
  lambdaName: "order-api",
  rewritablePrefixes: [
    "/api/storefront",
    "/api/notifications"
  ]
});
