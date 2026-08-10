import { Injectable } from "@nestjs/common";
import { env } from "./env.js";

type RuntimeConfig = {
  vnpayTmnCode: string;
  vnpayHashSecret: string;
  vnpayPaymentUrl: string;
  vnpayReturnUrl: string;
  vnpayIpnUrl: string;
};

@Injectable()
export class RuntimeConfigService {
  private cachedConfig: RuntimeConfig | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 5 * 60 * 1000;

  getPaymentConfig() {
    if (this.cachedConfig && Date.now() - this.cachedAt < this.ttlMs) {
      return this.cachedConfig;
    }

    this.cachedConfig = {
      // In AWS these env vars are resolved from SSM-backed CDK dynamic references.
      vnpayTmnCode: env.VNPAY_TMN_CODE,
      vnpayHashSecret: env.VNPAY_HASH_SECRET,
      vnpayPaymentUrl: env.VNPAY_PAYMENT_URL,
      vnpayReturnUrl: env.VNPAY_RETURN_URL,
      vnpayIpnUrl: env.VNPAY_IPN_URL
    };
    this.cachedAt = Date.now();

    return this.cachedConfig;
  }
}
