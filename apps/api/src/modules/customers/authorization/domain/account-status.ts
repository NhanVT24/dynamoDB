export type UserAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED";
export function normalizeUserAccountStatus(status: unknown): UserAccountStatus {
    const value = String(status || "").trim().toUpperCase();
    return value === "SUSPENDED" || value === "DISABLED" || value === "BLOCKED" ? value : "ACTIVE";
}
export function canSignIn(status: unknown) { return normalizeUserAccountStatus(status) === "ACTIVE"; }
