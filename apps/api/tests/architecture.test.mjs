import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkArchitecture } from "../scripts/check-architecture.js";

function fixture(files, run) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, "supermarket-architecture-"));
  try {
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
    }
    run(root);
  } finally {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("supermarket-architecture-")) {
      throw new Error("Refusing to clean a fixture outside its allocated temporary directory.");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

test("allows core dependencies and ignores comments/outer composition imports", () => fixture({
  "modules/product/domain/product.ts": "export interface Product { id: string }",
  "modules/product/application/read.ts": 'import type { Product } from "../domain/product.js"; // import SDK from "aws"',
  "modules/product/product.module.ts": 'import "@nestjs/common";'
}, root => assert.deepEqual(checkArchitecture(root), { checkedFiles: 2, violations: [] })));

test("rejects erased imports, barrels, external types and domain -> application", () => fixture({
  "modules/product/domain/product.ts": 'import type { Port } from "../application/port.js";',
  "modules/product/application/port.ts": 'export type Port = import("@aws-sdk/client-dynamodb").AttributeValue;',
  "modules/product/application/read.ts": 'export * from "../bridge.js"; import type { Row } from "../infrastructure/db.js";',
  "modules/product/bridge.ts": 'export * from "./infrastructure/db.js";',
  "modules/product/infrastructure/db.ts": "export interface Row {}"
}, root => assert.equal(checkArchitecture(root).violations.length, 4)));

test("rejects require, dynamic and computed imports without scanning string contents", () => fixture({
  "modules/product/application/read.ts": 'const text = "import(whatever)"; require("node:fs"); import("node:fs"); import(provider);'
}, root => assert.equal(checkArchitecture(root).violations.length, 3)));
