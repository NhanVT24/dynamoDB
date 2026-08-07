function decodeJwtPayload(token) {
    try {
        const [, payload = ""] = token.split(".");
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
        return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    }
    catch {
        return null;
    }
}
function toGroups(value) {
    if (Array.isArray(value)) {
        return value.map((group) => String(group).trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((group) => group.trim().toLowerCase())
            .filter(Boolean);
    }
    return [];
}
function readGroupsFromApiGatewayEvent(encodedEvent) {
    if (!encodedEvent)
        return [];
    try {
        const decodedEvent = decodeURIComponent(encodedEvent);
        const event = JSON.parse(decodedEvent);
        return toGroups(event.requestContext?.authorizer?.claims?.["cognito:groups"]);
    }
    catch {
        return [];
    }
}
function readGroupsFromAuthorizationHeader(authorizationHeader) {
    if (!authorizationHeader?.startsWith("Bearer "))
        return [];
    const token = authorizationHeader.slice("Bearer ".length).trim();
    if (!token)
        return [];
    const payload = decodeJwtPayload(token);
    return toGroups(payload?.["cognito:groups"]);
}
export function extractCognitoGroups(headers) {
    const apiGatewayEventHeader = headers["x-apigateway-event"];
    if (typeof apiGatewayEventHeader === "string") {
        const groupsFromEvent = readGroupsFromApiGatewayEvent(apiGatewayEventHeader);
        if (groupsFromEvent.length > 0) {
            return groupsFromEvent;
        }
    }
    const authorizationHeader = headers.authorization;
    if (typeof authorizationHeader === "string") {
        return readGroupsFromAuthorizationHeader(authorizationHeader);
    }
    return [];
}
export function isAdminRequest(headers) {
    return extractCognitoGroups(headers).includes("admin");
}
