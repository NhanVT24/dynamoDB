import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { ZodError } from "zod";

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();
    const correlationId = String((request as { correlationId?: string })?.correlationId ?? "");
    const errorName =
      exception instanceof Error
        ? exception.name
        : typeof exception === "object" && exception !== null
          ? String((exception as { name?: string }).name ?? "UnknownError")
          : "UnknownError";
    const errorMessage =
      exception instanceof Error
        ? exception.message
        : typeof exception === "object" && exception !== null
          ? String((exception as { message?: string }).message ?? "Unknown error")
          : String(exception);
    const errorStack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error("api request failed", {
      correlationId,
      err: exception,
      errorName,
      errorMessage,
      errorStack,
      method: request?.method,
      url: request?.url,
      query: request?.query,
      params: request?.params,
      body: request?.body
    });
    console.error("[api-error] request_failed", {
      correlationId,
      errorName,
      errorMessage,
      errorStack,
      method: request?.method,
      url: request?.url,
      query: request?.query,
      params: request?.params,
      body: request?.body
    });

    if (exception instanceof ZodError || Array.isArray((exception as { issues?: unknown[] })?.issues)) {
      return response.status(HttpStatus.BAD_REQUEST).send({
        correlationId,
        message: "Invalid request",
        issues: (exception as ZodError).issues ?? (exception as { issues?: unknown[] }).issues
      });
    }

    if (exception instanceof HttpException) {
      return response
        .status(exception.getStatus())
        .send(exception.getResponse());
    }

    if (
      (exception instanceof Error && exception.name === "ConditionalCheckFailedException") ||
      (typeof exception === "object" &&
        exception !== null &&
        ((exception as { name?: string }).name === "ConditionalCheckFailedException" ||
          (exception as { code?: string }).code === "ConditionalCheckFailedException"))
    ) {
      return response.status(HttpStatus.CONFLICT).send({
        correlationId,
        message: "Record changed, missing, or condition failed"
      });
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      correlationId,
      message: "Internal server error"
    });
  }
}
