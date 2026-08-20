import "reflect-metadata";
import { createQueueHandler } from "../shared/queue-factory.js";

export const handler = createQueueHandler({
  lambdaName: "payment-worker",
  worker: "payments",
  queueName: "paymentEvents"
});
