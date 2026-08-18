import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";

import { AppModule } from "./app.module.js";

let appContextPromise: Promise<INestApplicationContext> | null = null;

export async function createStandaloneContext(): Promise<INestApplicationContext> {
  appContextPromise ??= NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  }).then((appContext) => {
    appContext.useLogger(["log", "error", "warn", "debug", "verbose"]);
    appContext.flushLogs();
    return appContext;
  });

  return appContextPromise;
}
