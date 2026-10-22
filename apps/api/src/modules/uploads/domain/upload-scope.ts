import { BusinessError } from "../../../common/domain/business-error.js";
/** Storage namespace value object; no SDK, presigning or network access here. */
export class UploadScope {
    readonly value: string;
    constructor(value: string) { this.value = value.trim().replace(/^\/+|\/+$/g, ""); Object.freeze(this); }
    imagePrefixFor(actor: {
        subject: string;
        isAdmin: boolean;
    }): string {
        const canonical = this.value === "products" ? "public/products" : this.value === "avatars" ? `public/avatars/${actor.subject}` : this.value;
        if (canonical !== "public/products" && canonical !== `public/avatars/${actor.subject}` && !(actor.isAdmin && canonical === "public/default-avatars")) {
            throw new BusinessError("INVALID_INPUT", "Image upload scope is not allowed.");
        }
        return canonical;
    }
    static assertPrivateReportKey(key: string): void {
        if (!key.startsWith("private/admin-reports/"))
            throw new BusinessError("INVALID_INPUT", "Invalid private report key");
    }
}
