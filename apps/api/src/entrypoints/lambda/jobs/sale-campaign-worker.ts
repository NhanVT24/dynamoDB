import "reflect-metadata";
import { SalesService } from "../../../modules/sales/sales.service.js";
export const handler = async (event: { campaignId?: string; action?: string }) => new SalesService().handleScheduleEvent(event);
