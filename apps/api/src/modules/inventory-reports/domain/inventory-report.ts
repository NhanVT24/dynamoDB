export class InventoryReport {
    readonly reportDate: string;
    constructor(referenceDate: Date) {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(referenceDate);
        const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
        this.reportDate = `${values.year}-${values.month}-${values.day}`;
        Object.freeze(this);
    }
    get id() { return `daily-inventory-${this.reportDate}`; }
    get isScheduled() {
        const [year, month, day] = this.reportDate.split("-").map(Number);
        const elapsed = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(2026, 0, 1)) / 86400000);
        return elapsed >= 0 && elapsed % 2 === 0;
    }
    classify<T extends {
        status: string;
    }>(products: readonly T[]) {
        return { lowStockProducts: products.filter(product => product.status === "low_stock"),
            outOfStockProducts: products.filter(product => product.status === "out_of_stock") };
    }
}
