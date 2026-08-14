import "reflect-metadata";
import { createHttpHandler } from "./lambda/http-factory.js";

export const handler = createHttpHandler({
  lambdaName: "payment-vnpay-api",
  rewritablePrefixes: [
    "/api/payments/vnpay"
  ]
});
