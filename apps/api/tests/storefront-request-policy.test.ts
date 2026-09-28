import assert from "node:assert/strict";
import { test } from "node:test";
import { isCustomerOrderMutation } from "../src/core/app/storefront-request-policy.ts";

test("customer order guard includes refund request and status refresh", () => {
  assert.equal(isCustomerOrderMutation("POST", "/api/storefront/orders/order-1/refund"), true);
  assert.equal(isCustomerOrderMutation("POST", "/api/storefront/orders/order-1/refund/status"), true);
  assert.equal(isCustomerOrderMutation("POST", "/api/storefront/orders/order-1/refund/status?source=poll"), true);
  assert.equal(isCustomerOrderMutation("POST", "/api/storefront/orders/order-1/cancel"), true);
  assert.equal(isCustomerOrderMutation("DELETE", "/api/storefront/orders/order-1/refund"), false);
  assert.equal(isCustomerOrderMutation("POST", "/api/admin/orders/order-1/refund"), false);
});
