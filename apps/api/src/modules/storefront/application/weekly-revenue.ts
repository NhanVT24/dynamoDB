import { RevenueReport } from "../domain/revenue-report.js";
import type { RevenueOrder } from "../domain/revenue-report.js";
export type { RevenueOrder, RevenueLine } from "../domain/revenue-report.js";
export interface RevenueReader { list(): Promise<RevenueOrder[]>; }
export class BuildWeeklyRevenue {
 constructor(private readonly reader: RevenueReader) {}
 async execute(referenceDate = new Date()) { return new RevenueReport(await this.reader.list(), referenceDate).toSnapshot(); }
}
