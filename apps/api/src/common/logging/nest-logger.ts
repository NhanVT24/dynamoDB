import { ConsoleLogger, type LogLevel } from "@nestjs/common";

const defaultLogLevels: LogLevel[] = ["log", "error", "warn", "debug", "verbose"];

export function createNestLogger(context?: string) {
  return new ConsoleLogger(context, {
    logLevels: defaultLogLevels,
    colors: false,
    compact: true,
    timestamp: true
  });
}

