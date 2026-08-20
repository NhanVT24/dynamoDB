import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";

import { createNestLogger } from "../../common/logging/nest-logger.js";
import { AppModule } from "./app.module.js";

let appContextPromise: Promise<INestApplicationContext> | null = null;

export async function createStandaloneContext(): Promise<INestApplicationContext> {
  appContextPromise ??= NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
    logger: createNestLogger()
  }).then((appContext) => {
    appContext.useLogger(createNestLogger());
    appContext.flushLogs();
    return appContext;
  });

  return appContextPromise;
}
