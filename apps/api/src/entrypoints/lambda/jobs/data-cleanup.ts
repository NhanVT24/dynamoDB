import "reflect-metadata";
import { runScheduledDataCleanup } from "../../../modules/data-cleanup/data-cleanup.service.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-schedule:data-cleanup] received", JSON.stringify(event));
  return runScheduledDataCleanup();
};
