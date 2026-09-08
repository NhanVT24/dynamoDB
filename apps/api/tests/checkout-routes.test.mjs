import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";

Object.assign(process.env, {
  VNPAY_TMN_CODE: "TEST0001", VNPAY_HASH_SECRET: "local-test-only-secret",
  VNPAY_RETURN_URL: "http://localhost/result", VNPAY_IPN_URL: "http://localhost/ipn"
});
const { StorefrontController } = await import("../dist/src/modules/storefront/storefront.controller.js");
const { StorefrontService } = await import("../dist/src/modules/storefront/storefront.service.js");

test("order routes dispatch authenticated requests; legacy checkout routes are absent", async () => {
  const calls = [];
  const service = Object.fromEntries([
    "createOrder", "getOrderStatus", "cancelOrder"
  ].map((name) => [name, async (...args) => {
    calls.push({ name, args });
    return { status: "allowed", requestId: args[1] };
  }]));
  class TestModule {}
  Module({ controllers: [StorefrontController], providers: [{ provide: StorefrontService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    // This fixture exercises the existing principal-to-controller contract only.
    const token = "fixture." + Buffer.from(JSON.stringify({ email: "customer@example.com", role: "customer" })).toString("base64url") + ".fixture";
    const requestId = "11111111-1111-4111-8111-111111111111";
    const routes = [
      ["POST", "/orders", { items: [{ productId: requestId, quantity: 1 }] }, 202],
      ["GET", "/orders/" + requestId + "/status", undefined, 200],
      ["POST", "/orders/" + requestId + "/cancel", undefined, 200]
    ];
    for (const [method, path, payload, status] of routes) {
      const url = "/api/storefront" + path;
      const anonymous = await app.inject({ method, url, payload });
      assert.equal(anonymous.statusCode, 403);
      const response = await app.inject({ method, url, payload, headers: { authorization: "Bearer " + token } });
      assert.equal(response.statusCode, status, response.body);
    }
    assert.deepEqual(calls.map((call) => call.name), Object.keys(service));
    assert.ok(calls.every((call) => call.args[0] === "customer@example.com"));
    assert.equal(calls[2].args[1], requestId);
    for (const path of ["prepare", "payment-session", "cancel"]) {
      const response = await app.inject({ method: "POST", url: "/api/storefront/checkout/" + path, payload: {} });
      assert.equal(response.statusCode, 404);
    }
  } finally {
    await app.close();
  }
});
