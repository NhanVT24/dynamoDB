import * as routes from "../email-route.repository.js";
import { publishEventBridgeEvent } from "../../../integrations/eventbridge/publisher.js";
import { publishAdminAlert } from "../../../integrations/sns/publisher.js";
import { nextEmailPublishRetryAt } from "../email-publish-retry.js";
import type { EmailRecoveryPorts } from "../application/recovery-ports.js";
export const emailRecoveryPorts: EmailRecoveryPorts = { ...routes, publishAdminAlert, nextEmailPublishRetryAt,
    publishRoute: route => publishEventBridgeEvent({ busName: route.eventBusName, source: route.eventSource, detailType: route.eventDetailType, detail: route.eventDetail }) };
