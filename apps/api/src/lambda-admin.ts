import "reflect-metadata";
import { createHttpHandler } from "./lambda/http-factory.js";

export const handler = createHttpHandler({
  lambdaName: "admin-api",
  rewritablePrefixes: [
    "/api/storefront",
    "/api/products",
    "/api/notifications",
    "/api/payments/vnpay"
  ]
});
