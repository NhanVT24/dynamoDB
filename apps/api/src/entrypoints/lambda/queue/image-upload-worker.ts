import "reflect-metadata";
import { createQueueHandler } from "../shared/queue-factory.js";

export const handler = createQueueHandler({
  lambdaName: "image-upload-worker",
  worker: "uploads",
  queueName: "imageUploads"
});
