import { BusinessError } from "../../../../common/domain/business-error.js";
import type { UserAddress } from "./user-address.js";
export interface UserProfileSnapshot {
    displayName: string;
    avatarKey: string;
    addresses: UserAddress[];
}
export interface UserProfilePatch {
    displayName?: string;
    avatarKey?: string;
    addresses?: UserAddress[];
}
export class UserProfile {
    readonly #state: UserProfileSnapshot;
    constructor(readonly subject: string, snapshot: UserProfileSnapshot) {
        this.#state = { ...snapshot, addresses: snapshot.addresses.map(address => ({ ...address, ward: { ...address.ward } })) };
    }
    toSnapshot(): UserProfileSnapshot {
        return { ...this.#state, addresses: this.#state.addresses.map(address => ({ ...address, ward: { ...address.ward } })) };
    }
    static assertAvatarKey(subject: string, key: string): void {
        if (key && !key.startsWith(`public/avatars/${subject}/`) && !key.startsWith("public/default-avatars/")) {
            throw new BusinessError("INVALID_INPUT", "Avatar key is not allowed.");
        }
    }
    update(patch: UserProfilePatch): UserProfile {
        const changes = new ProfileChange(this.subject, patch).toSnapshot();
        return new UserProfile(this.subject, { ...this.#state, ...changes, addresses: changes.addresses ?? this.#state.addresses });
    }
}
/** Validated partial change; preserves patch semantics without reading and
 * rewriting unrelated profile fields during concurrent HTTP updates.
 */
export class ProfileChange {
    readonly #changes: Readonly<UserProfilePatch>;
    constructor(subject: string, patch: UserProfilePatch) {
        if (patch.avatarKey !== undefined)
            UserProfile.assertAvatarKey(subject, patch.avatarKey);
        this.#changes = Object.freeze({ ...patch, ...(patch.addresses === undefined ? {} : {
                addresses: patch.addresses.map(address => ({ ...address, ward: { ...address.ward } }))
            }) });
    }
    get avatarKey() { return this.#changes.avatarKey; }
    toSnapshot(): UserProfilePatch {
        return { ...this.#changes, ...(this.#changes.addresses === undefined ? {} : {
                addresses: this.#changes.addresses.map(address => ({ ...address, ward: { ...address.ward } }))
            }) };
    }
}
