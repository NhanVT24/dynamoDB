import "reflect-metadata";
import { createQueueHandler } from "../shared/queue-factory.js";

export const handler = createQueueHandler({
  lambdaName: "checkout-gate-worker",
  worker: "checkoutGate",
  queueName: "checkoutGate"
});
