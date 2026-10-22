import { UserAccount } from "../domain/user-account.js";
import { ApplicationError } from "../../../../common/application/application-error.js";
import type { ProductPermission } from "../../../../common/domain/product-permissions.js";
import { type UserAccountStatus } from "../domain/account-status.js";
import type { UserAddress } from "../domain/user-address.js";
export interface DirectoryUser {
    subject: string;
    username: string;
    email: string;
    displayName: string;
}
export interface UserDirectory {
    listUsers(): Promise<DirectoryUser[]>;
}
export interface AuthorizationStore {
    getUserProfileSummary(subject: string): Promise<{
        accountStatus: UserAccountStatus;
        lastLoginAt: string;
        displayName: string;
        addresses: UserAddress[];
    }>;
    getUserPermissions(subject: string): Promise<ProductPermission[]>;
    addUserPermission(subject: string, permission: ProductPermission, actor: string): Promise<ProductPermission[]>;
    removeUserPermission(subject: string, permission: ProductPermission, actor: string): Promise<ProductPermission[]>;
    updateUserAccountStatus(subject: string, status: UserAccountStatus, actor: string): Promise<UserAccountStatus>;
    updateUserAddresses(subject: string, addresses: UserAddress[], actor: string): Promise<UserAddress[]>;
}
export class AuthorizationUseCases {
    constructor(private readonly directory: UserDirectory, private readonly store: AuthorizationStore) { }
    async listUsers() {
        const users = await this.listCognitoUsers();
        return Promise.all(users.map(async (user) => {
            const [profile, permissions] = await Promise.all([
                this.store.getUserProfileSummary(user.subject),
                this.store.getUserPermissions(user.subject)
            ]);
            return {
                ...user,
                ...profile,
                displayName: profile.displayName || user.displayName,
                permissions
            };
        }));
    }
    private listCognitoUsers() { return this.directory.listUsers(); }
    async addPermission(subject: string, permission: ProductPermission, actorSubject: string) {
        await this.assertUserExists(subject);
        return { subject, permissions: await this.store.addUserPermission(subject, permission, actorSubject) };
    }
    async removePermission(subject: string, permission: ProductPermission, actorSubject: string) {
        await this.assertUserExists(subject);
        return { subject, permissions: await this.store.removeUserPermission(subject, permission, actorSubject) };
    }
    async updateAccountStatus(subject: string, status: UserAccountStatus, actorSubject: string) {
        await this.assertUserExists(subject);
        const normalizedStatus = new UserAccount({ subject, status }).statusChangedBy(actorSubject, status).status;
        return { subject, accountStatus: await this.store.updateUserAccountStatus(subject, normalizedStatus, actorSubject) };
    }
    async updateAddresses(subject: string, addresses: UserAddress[], actorSubject: string) {
        await this.assertUserExists(subject);
        return { subject, addresses: await this.store.updateUserAddresses(subject, addresses, actorSubject) };
    }
    private async assertUserExists(subject: string) {
        const users = await this.listCognitoUsers();
        if (!users.some((user) => user.subject === subject)) {
            throw new ApplicationError("NOT_FOUND", "Cognito user not found");
        }
    }
}
