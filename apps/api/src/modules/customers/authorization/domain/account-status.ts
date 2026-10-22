import { UserAccount } from "./user-account.js";
export type UserAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED";
export function normalizeUserAccountStatus(status: unknown): UserAccountStatus {
    return UserAccount.normalizeStatus(status);
}
export function canSignIn(status: unknown) { return new UserAccount({ subject: "", status }).canSignIn; }
