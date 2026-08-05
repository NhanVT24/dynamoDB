var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AppExceptionFilter_1;
import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ZodError } from "zod";
let AppExceptionFilter = AppExceptionFilter_1 = class AppExceptionFilter {
    logger = new Logger(AppExceptionFilter_1.name);
    catch(exception, host) {
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
        if (exception instanceof ZodError || Array.isArray(exception?.issues)) {
            return response.status(HttpStatus.BAD_REQUEST).send({
                message: "Invalid request",
                issues: exception.issues ?? exception.issues
            });
        }
        if (exception instanceof HttpException) {
            return response
                .status(exception.getStatus())
                .send(exception.getResponse());
        }
        if (exception instanceof Error && exception.name === "ConditionalCheckFailedException") {
            return response.status(HttpStatus.CONFLICT).send({
                message: "Record changed, missing, or condition failed"
            });
        }
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
            message: "Internal server error"
        });
    }
};
AppExceptionFilter = AppExceptionFilter_1 = __decorate([
    Catch()
], AppExceptionFilter);
export { AppExceptionFilter };
