export interface EmailRouteMatches {
    /** Advance monotonically; duplicate or untracked events return false. */
    markMatched(emailJobId: string): Promise<boolean>;
}
export class TrackEmailRouteMatch {
    constructor(private readonly routes: EmailRouteMatches) { }
    async execute(emailJobId: string) {
        return { tracked: await this.routes.markMatched(emailJobId) };
    }
}
