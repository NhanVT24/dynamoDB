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

    this.logger.error("api request failed", {
      err: exception,
      method: request?.method,
      url: request?.url,
      query: request?.query,
      params: request?.params,
      body: request?.body
    });

    if (exception instanceof ZodError || Array.isArray((exception as { issues?: unknown[] })?.issues)) {
      return response.status(HttpStatus.BAD_REQUEST).send({
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
        message: "Record changed, missing, or condition failed"
      });
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      message: "Internal server error"
    });
  }
}
