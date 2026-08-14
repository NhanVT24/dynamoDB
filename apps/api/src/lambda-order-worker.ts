import "reflect-metadata";
import { createQueueHandler } from "./lambda/queue-factory.js";

export const handler = createQueueHandler({
  lambdaName: "order-worker",
  worker: "storefront"
});
