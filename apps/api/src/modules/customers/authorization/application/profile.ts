import { ApplicationError } from "../../../../common/application/application-error.js";
import type { UserAddress } from "../domain/user-address.js";
export interface Profile {
    displayName: string;
    avatarKey: string;
    addresses: UserAddress[];
}
export interface ProfilePatch {
    displayName?: string;
    avatarKey?: string;
    addresses?: UserAddress[];
}
export interface ProfileRepository {
    find(subject: string): Promise<Profile>;
    /** Update an existing USER_PROFILE only; never upsert a missing/unrelated row. */
    update(subject: string, patch: ProfilePatch): Promise<void>;
}
export interface ProfileAvatars {
    exists(key: string): Promise<boolean>;
    publicUrl(key: string): string;
}
export class ProfileQueries {
    constructor(private readonly profiles: ProfileRepository, private readonly avatars: ProfileAvatars) { }
    async get(subject: string) {
        const profile = await this.profiles.find(subject);
        return { ...profile, avatarUrl: this.avatars.publicUrl(profile.avatarKey) };
    }
}
export class UpdateProfile {
    constructor(private readonly profiles: ProfileRepository, private readonly avatars: ProfileAvatars, private readonly queries: ProfileQueries) { }
    async execute(subject: string, patch: ProfilePatch) {
        if (patch.avatarKey) {
            if (!patch.avatarKey.startsWith(`public/avatars/${subject}/`) && !patch.avatarKey.startsWith("public/default-avatars/")) {
                throw new ApplicationError("INVALID_INPUT", "Avatar key is not allowed.");
            }
            if (!await this.avatars.exists(patch.avatarKey))
                throw new ApplicationError("INVALID_INPUT", "Avatar image does not exist.");
        }
        await this.profiles.update(subject, patch);
        return this.queries.get(subject);
    }
}
