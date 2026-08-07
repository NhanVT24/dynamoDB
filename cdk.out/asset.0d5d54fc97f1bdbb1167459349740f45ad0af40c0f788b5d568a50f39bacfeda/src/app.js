import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { isAdminRequest } from "./common/auth/cognito-groups.js";
import { extractCognitoPrincipal } from "./common/auth/cognito-principal.js";
import { env } from "./config/env.js";
import { AppExceptionFilter } from "./common/filters/app-exception.filter.js";
export async function createNestApp() {
    const adapter = new FastifyAdapter({ logger: true });
    const app = await NestFactory.create(AppModule, adapter, {
        bufferLogs: true
    });
    app.enableCors({
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true);
            const allowedDevOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
                /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
            callback(null, allowedDevOrigin);
        }
    });
    app.useGlobalPipes(new ValidationPipe({
        transform: true,
        whitelist: false
    }));
    app.useGlobalFilters(new AppExceptionFilter());
    app.setGlobalPrefix("");
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook("onRequest", async (request, _reply) => {
        request.log.info({
            method: request.method,
            url: request.url,
            query: request.query,
            params: request.params
        }, "incoming api request");
    });
    fastify.addHook("preHandler", async (request, reply) => {
        const method = request.method.toUpperCase();
        const isReadOnlyMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
        const url = String(request.url || "");
        const isPublicStorefrontRead = isReadOnlyMethod && url.startsWith("/api/storefront/");
        const isPublicProductsRead = isReadOnlyMethod && url.startsWith("/api/products");
        const isStorefrontOrderMutation = method === "POST" && url === "/api/storefront/orders";
        if (isReadOnlyMethod || isPublicStorefrontRead || isPublicProductsRead) {
            return;
        }
        if (isStorefrontOrderMutation) {
            const principal = extractCognitoPrincipal(request.headers);
            if (principal && (principal.role === "customer" || principal.role === "admin")) {
                return;
            }
            reply.status(403).send({
                statusCode: 403,
                message: "Chỉ tài khoản customer hoặc admin mới được đặt hàng."
            });
            return;
        }
        if (isAdminRequest(request.headers)) {
            return;
        }
        reply.status(403).send({
            statusCode: 403,
            message: "Chỉ tài khoản admin mới được tạo, sửa hoặc xóa dữ liệu."
        });
    });
    fastify.addHook("onResponse", async (request, reply) => {
        request.log.info({
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode
        }, "api response sent");
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    app.enableShutdownHooks();
    return app;
}
export async function startNestApp() {
    const app = await createNestApp();
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    return app;
}
