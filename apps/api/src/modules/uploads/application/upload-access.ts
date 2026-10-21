import { ApplicationError } from "../../../common/application/application-error.js";
export interface UploadInput {
    fileName?: string;
    contentType?: string;
    scope?: string;
}
export interface UploadActor {
    subject: string;
    isAdmin: boolean;
}
export interface UploadGrant {
    bucket: string;
    key: string;
    contentType: string;
    uploadUrl: string;
    fileUrl: string;
    expiresIn: number;
}
export interface StorageItem {
    key: string;
    fileName: string;
    size: number;
    updatedAt: string;
    fileUrl?: string;
}
export interface UploadStorage {
    put(scope: string, input: UploadInput): Promise<UploadGrant>;
    list(prefix: string): Promise<{
        items: StorageItem[];
    }>;
    open(key: string): Promise<{
        key: string;
        downloadUrl: string;
        expiresIn: number;
    }>;
}
export class UploadAccess {
    constructor(private readonly storage: UploadStorage) { }
    image(input: UploadInput, actor: UploadActor) {
        const scope = (input.scope ?? "products").trim().replace(/^\/+|\/+$/g, "");
        const canonical = scope === "products" ? "public/products" : scope === "avatars" ? `public/avatars/${actor.subject}` : scope;
        if (canonical !== "public/products" && canonical !== `public/avatars/${actor.subject}` && !(actor.isAdmin && canonical === "public/default-avatars")) {
            throw new ApplicationError("INVALID_INPUT", "Image upload scope is not allowed.");
        }
        return this.storage.put(canonical, input);
    }
    defaultAvatar(input: UploadInput) { return this.storage.put("public/default-avatars", input); }
    defaults() { return this.storage.list("public/default-avatars"); }
    async report(input: UploadInput) { const { fileUrl: _privateUrl, ...grant } = await this.storage.put("private/admin-reports", input); return grant; }
    async reports() { const page = await this.storage.list("private/admin-reports"); return { items: page.items.map(({ fileUrl: _url, ...item }) => item) }; }
    open(key: string) { if (!key.startsWith("private/admin-reports/"))
        throw new ApplicationError("INVALID_INPUT", "Invalid private report key"); return this.storage.open(key); }
}
