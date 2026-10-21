import "reflect-metadata";
import { createSalesService } from "../../../modules/sales/sales.composition.js";
export const handler = async (event: { campaignId?: string; action?: string }) => createSalesService().handleScheduleEvent(event);
