export interface RecoverableEmailRoute {
    emailJobId: string;
    campaignId: string;
    publishAttempts: number;
    publishFailureReason?: string;
    eventBusName?: string;
    eventSource: string;
    eventDetailType: string;
    eventDetail: Record<string, unknown>;
    eventId?: string;
    publishedAt?: string;
}
export interface EmailRecoveryPorts {
    findDueEmailRoutePublishes(now: string): Promise<RecoverableEmailRoute[]>;
    claimEmailRoutePublish(input: {
        emailJobId: string;
        expectedAttempt: number;
        maxAttempts: number;
        now: string;
        leaseUntil: string;
    }): Promise<RecoverableEmailRoute | null>;
    markEmailRoutePublishFailed(input: {
        emailJobId: string;
        attempt: number;
        reason: string;
    }): Promise<boolean>;
    markEmailRoutePublished(input: {
        emailJobId: string;
        eventId: string;
    }): Promise<boolean>;
    markEmailRoutePublishRetry(input: {
        emailJobId: string;
        attempt: number;
        reason: string;
        nextPublishAt: string;
    }): Promise<boolean>;
    markEmailRouteAlertResult(input: {
        emailJobId: string;
        sent: boolean;
        messageId?: string;
    }): Promise<void>;
    findStalePublishedEmailRoutes(cutoff: string): Promise<RecoverableEmailRoute[]>;
    markEmailRouteRoutingSuspected(id: string): Promise<boolean>;
    publishRoute(route: RecoverableEmailRoute): Promise<{
        eventId: string;
    }>;
    publishAdminAlert(input: {
        subject: string;
        message: string;
        attributes: Record<string, string>;
    }): Promise<{
        messageId: string;
    }>;
    nextEmailPublishRetryAt(attempt: number): string;
}
