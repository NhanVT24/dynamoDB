import crypto from "node:crypto";

export function serializeVnpayParams(params: Record<string, string>): string {
  return Object.keys(params).sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]).replace(/%20/g, "+")}`)
    .join("&");
}

export function signVnpayParams(params: Record<string, string>, secret: string): string {
  return crypto.createHmac("sha512", secret).update(serializeVnpayParams(params), "utf8").digest("hex");
}

export function verifyVnpaySignature(raw: Record<string, unknown>, secret: string) {
  const query: Record<string, string> = {};
  let invalidValue = false;
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("vnp_")) continue;
    if (typeof value !== "string") {
      invalidValue = true;
      continue;
    }
    query[key] = value;
  }
  const receivedHash = query.vnp_SecureHash ?? "";
  const params = { ...query };
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  let reason = invalidValue ? "non_scalar_parameter"
    : !receivedHash ? "missing_hash"
    : !/^[a-fA-F0-9]{128}$/.test(receivedHash) ? "invalid_hash_format"
    : "verified";
  if (reason === "verified") {
    const expected = Buffer.from(signVnpayParams(params, secret), "hex");
    if (!crypto.timingSafeEqual(Buffer.from(receivedHash, "hex"), expected)) reason = "checksum_mismatch";
  }
  return { query, isValidSignature: reason === "verified", reason, hashLength: receivedHash.length };
}
