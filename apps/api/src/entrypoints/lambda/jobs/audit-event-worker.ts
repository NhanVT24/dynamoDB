import "reflect-metadata";
import { auditFieldDenylist, auditFieldWhitelist } from "../../../modules/audit-log/audit-log.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-eventbridge:audit-event-worker] received", {
    event,
    auditPolicy: {
      whitelist: auditFieldWhitelist,
      denylist: auditFieldDenylist
    }
  });

  return {
    ok: true
  };
};
