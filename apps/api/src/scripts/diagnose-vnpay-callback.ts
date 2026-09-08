import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { verifyVnpaySignature } from "../modules/vnpay/vnpay-signature.js";

// Offline only: never submits a synthetic payment callback to any server.
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run diagnose:vnpay -w @supermarket/api -- <absolute-path-to-callback.txt>");
  const input = (await readFile(file, "utf8")).trim();
  const params = new URLSearchParams(input.startsWith("http") ? new URL(input).search : input.replace(/^\?/, ""));
  const query: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  const result = verifyVnpaySignature(query, env.VNPAY_HASH_SECRET);
  const required = ["vnp_TmnCode", "vnp_TxnRef", "vnp_Amount", "vnp_ResponseCode", "vnp_TransactionStatus", "vnp_TransactionNo"];
  console.log(JSON.stringify({
    mode: "offline; uses local environment, does not verify deployed Lambda configuration",
    reason: result.reason, hashLength: result.hashLength,
    merchantMatches: result.query.vnp_TmnCode === env.VNPAY_TMN_CODE,
    missingCallbackFields: required.filter((key) => !result.query[key]),
    looksLikePaymentCreationUrl: Boolean(result.query.vnp_ReturnUrl || result.query.vnp_Command === "pay"),
    queryKeys: Object.keys(query).sort()
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to inspect callback");
  process.exitCode = 1;
});
