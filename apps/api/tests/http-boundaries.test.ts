import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getRequestPrincipal, requireRequestPrincipal } from "../src/common/auth/request-principal.js";
import { env } from "../src/config/env.js";
import { requestFailureContext } from "../src/common/logging/request-failure-context.js";

function token(payload: Record<string, unknown>) {
  return `Bearer header.${Buffer.from(JSON.stringify({ sub: "user-1", email: "user@example.test", role: "customer", ...payload })).toString("base64url")}.signature`;
}

test("request auth shares one promise within a request and isolates concurrent callers", async () => {
  const previous = env.AUTH_ALLOW_UNVERIFIED_JWT; env.AUTH_ALLOW_UNVERIFIED_JWT = true;
  try {
    const first = { headers: { authorization: token({ sub: "one" }) } };
    const second = { headers: { authorization: token({ sub: "two" }) } };
    assert.equal(getRequestPrincipal(first), getRequestPrincipal(first));
    const results = await Promise.all([getRequestPrincipal(first), getRequestPrincipal(second)]);
    assert.deepEqual(results.map(result => result?.subject), ["one", "two"]);
    const missing = { headers: {} };
    assert.equal(await getRequestPrincipal(missing), null);
    await assert.rejects(requireRequestPrincipal(missing, { message: "Sign in" }), { message: "Sign in" });
  } finally { env.AUTH_ALLOW_UNVERIFIED_JWT = previous; }
});

test("request auth rejects suspended/malformed tokens and preserves delegated permission/admin rules", async () => {
  const previous = env.AUTH_ALLOW_UNVERIFIED_JWT; env.AUTH_ALLOW_UNVERIFIED_JWT = true;
  try {
    for (const authorization of ["Bearer invalid", token({ account_status: "SUSPENDED" }), token({ sub: "" })]) {
      await assert.rejects(requireRequestPrincipal({ headers: { authorization } }, { message: "Denied" }), { message: "Denied" });
    }
    const viewer = { headers: { authorization: token({ role: "viewer", permissions: ["products:create"] }) } };
    assert.equal((await requireRequestPrincipal(viewer, { permission: "products:create", message: "Denied" })).role, "viewer");
    await assert.rejects(requireRequestPrincipal(viewer, { roles: ["customer", "admin"], message: "Customer only" }), { message: "Customer only" });
    assert.equal((await requireRequestPrincipal({ headers: { authorization: token({ role: "admin" }) } },
      { permission: "products:delete-own", message: "Denied" })).role, "admin");
  } finally { env.AUTH_ALLOW_UNVERIFIED_JWT = previous; }
});

test("request error context excludes payload, query, raw URL and provider error secrets", () => {
  const request = { correlationId: "correlation", method: "POST", routeOptions: { url: "/orders/:id" },
    url: "/orders/private-email?signature=secret", body: { password: "secret" }, query: { token: "secret" } };
  const context = requestFailureContext(new Error("provider failure with secret signed URL"), request);
  assert.deepEqual(context, { correlationId: "correlation", method: "POST", route: "/orders/:id", errorName: "Error" });
  assert.equal(JSON.stringify(context).includes("secret"), false);
});

test("compiled controllers validate both product aliases and preserve customer/product authorization contracts", async () => {
  const { NestFactory } = await import("@nestjs/core");
  const { Module } = await import("@nestjs/common");
  const { FastifyAdapter } = await import("@nestjs/platform-fastify");
  const { StorefrontModule } = await import("../dist/src/modules/storefront/storefront.module.js");
  const { ShoppingModule } = await import("../dist/src/modules/shopping/shopping.module.js");
  const { AppExceptionFilter } = await import("../dist/src/common/filters/app-exception.filter.js");
  const { ListProducts } = await import("../dist/src/modules/storefront/application/read-catalog/read-catalog.js");
  const { CreateProduct } = await import("../dist/src/modules/shopping/application/create-product/create-product.js");
  const { CreateCheckout } = await import("../dist/src/modules/storefront/application/create-checkout/create-checkout.js");
  const { ShoppingService } = await import("../dist/src/modules/shopping/shopping.service.js");
  const { env: compiledEnv } = await import("../dist/src/config/env.js");
  class TestModule {}
  Module({ imports: [StorefrontModule, ShoppingModule] })(TestModule);
  const previous = compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT; compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT = true;
  const app = await NestFactory.create(TestModule, new FastifyAdapter(), { logger: false });
  app.useGlobalFilters(new AppExceptionFilter());
  const queries: unknown[] = [], creations: unknown[] = [], checkouts: unknown[] = [];
  app.get(ListProducts).execute = async query => { queries.push(query); return { items: [], pageInfo: { limit: query.limit, hasNextPage: false } }; };
  app.get(CreateProduct).execute = async command => { creations.push(command); return { id: "created" }; };
  app.get(CreateCheckout).execute = async (email, command) => { checkouts.push({ email, command }); return {} as never; };
  const shopping = app.get(ShoppingService);
  let managementReads = 0;
  shopping.listShoppingItems = async () => { managementReads++; return { items: [] } as never; };
  shopping.listAllShoppingItems = async () => { managementReads++; return { items: [] } as never; };
  shopping.getShoppingItemsPageCursor = async () => { managementReads++; return {} as never; };
  shopping.getShoppingItemById = async () => { managementReads++; return { id: "product" }; };
  try {
    await app.init(); const http = app.getHttpAdapter().getInstance(); await http.ready();
    for (const path of ["/api/products", "/api/storefront/products"]) {
      const invalid = await http.inject({ method: "GET", url: `${path}?limit=0` });
      assert.equal(invalid.statusCode, 400); assert.equal(invalid.json().message, "Invalid request");
      assert.equal((await http.inject({ method: "GET", url: `${path}?limit=24&search=desk` })).statusCode, 200);
    }
    assert.equal(queries.length, 2); assert.equal((queries[0] as { limit: number }).limit, 24);
    for (const path of ["/api/shopping-items", "/api/shopping-items/all", "/api/shopping-items/page-cursor",
      "/api/shopping-items/12345678-1234-4234-8234-123456789013"]) {
      assert.equal((await http.inject({ method: "GET", url: path })).statusCode, 403);
      assert.equal((await http.inject({ method: "GET", url: path, headers: { authorization: token({}) } })).statusCode, 403);
      assert.equal(managementReads, 0);
    }
    for (const path of ["/api/shopping-items", "/api/shopping-items/all", "/api/shopping-items/page-cursor",
      "/api/shopping-items/12345678-1234-4234-8234-123456789013"]) {
      assert.equal((await http.inject({ method: "GET", url: path, headers: { authorization: token({ role: "admin" }) } })).statusCode, 200);
    }
    assert.equal(managementReads, 4);
    const body = { name: "Product", category: "Gia dung", brand: "Test", sku: "SKU-1", stock: 20, price: 1000,
      imageUrl: "https://example.test/product.png", location: "Test", description: "Product description", ownerSub: "spoof" };
    assert.equal((await http.inject({ method: "POST", url: "/api/shopping-items", payload: body })).statusCode, 403);
    assert.equal((await http.inject({ method: "POST", url: "/api/shopping-items", headers: { authorization: token({}) }, payload: body })).statusCode, 403);
    const delegated = await http.inject({ method: "POST", url: "/api/shopping-items", headers: {
      authorization: token({ role: "viewer", permissions: ["products:create"] }) }, payload: body });
    assert.equal(delegated.statusCode, 201, delegated.body);
    assert.equal(creations.length, 1);
    assert.equal((creations[0] as { actor: { subject: string } }).actor.subject, "user-1");
    assert.equal("ownerSub" in (creations[0] as { details: object }).details, false);
    const cart = { items: [{ productId: "12345678-1234-4234-8234-123456789013", quantity: 1 }] };
    assert.equal((await http.inject({ method: "POST", url: "/api/storefront/orders", headers: { authorization: token({ role: "viewer" }) }, payload: cart })).statusCode, 403);
    assert.equal((await http.inject({ method: "POST", url: "/api/storefront/orders", headers: { authorization: token({}) }, payload: { items: [] } })).statusCode, 400);
    assert.equal(checkouts.length, 0);
    assert.equal((await http.inject({ method: "POST", url: "/api/storefront/orders", headers: { authorization: token({ email: "OWNER@EXAMPLE.TEST" }) }, payload: cart })).statusCode, 202);
    assert.equal((checkouts[0] as { email: string }).email, "owner@example.test");
  } finally { await app.close(); compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT = previous; }
});

test("full app preHandler, audit interceptor and controller preserve the same trusted actor", async () => {
  const { createNestApp } = await import("../dist/src/core/app/create-app.js");
  const { CreateProduct } = await import("../dist/src/modules/shopping/application/create-product/create-product.js");
  const { auditContext } = await import("../dist/src/modules/audit-log/audit-context.js");
  const { env: compiledEnv } = await import("../dist/src/config/env.js");
  const previous = compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT; compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT = true;
  const app = await createNestApp();
  let called = 0;
  app.get(CreateProduct).execute = async command => {
    called++; assert.equal(command.actor.subject, "user-1");
    assert.equal(auditContext.getStore()?.auditActorId, "user-1");
    return { id: "created" };
  };
  try {
    const http = app.getHttpAdapter().getInstance();
    const body = { name: "Product", category: "Gia dung", brand: "Test", sku: "SKU-1", stock: 20, price: 1000,
      imageUrl: "https://example.test/product.png", location: "Test", description: "Product description" };
    assert.equal((await http.inject({ method: "POST", url: "/api/shopping-items", payload: body })).statusCode, 403);
    const response = await http.inject({ method: "POST", url: "/api/shopping-items", payload: body,
      headers: { authorization: token({ role: "viewer", permissions: ["products:create"] }), "x-correlation-id": "x".repeat(129) } });
    assert.equal(response.statusCode, 201, response.body); assert.equal(called, 1);
    assert.match(String(response.headers["x-correlation-id"]), /^[a-f0-9-]{36}$/);
    assert.equal((await http.inject({ method: "GET", url: "/api/admin/ops/payment-reviews", headers: { authorization: token({}) } })).statusCode, 403);
    assert.equal((await http.inject({ method: "GET", url: "/api/shopping-items" })).statusCode, 403);
  } finally { await app.close(); compiledEnv.AUTH_ALLOW_UNVERIFIED_JWT = previous; }
});
