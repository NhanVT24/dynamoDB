import "reflect-metadata";
import { createHttpHandler } from "../shared/http-factory.js";

export const handler = createHttpHandler({
  lambdaName: "payment-vnpay-api",
  rewritablePrefixes: [
    "/api/payments/vnpay"
  ]
});
