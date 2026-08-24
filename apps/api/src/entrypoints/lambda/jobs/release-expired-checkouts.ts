import "reflect-metadata";
import { releaseExpiredCheckoutGates } from "../../../modules/storefront/storefront.repository.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-schedule:release-expired-checkouts] received", JSON.stringify(event));

  const releasedCount = await releaseExpiredCheckoutGates();

  return {
    ok: true,
    releasedCount,
    checkedAt: new Date().toISOString()
  };
};
