import "reflect-metadata";
import { createHttpHandler } from "./lambda/http-factory.js";

export const handler = createHttpHandler({
  lambdaName: "public-api",
  rewritablePrefixes: [
    "/api/storefront",
    "/api/products",
    "/health"
  ]
});
