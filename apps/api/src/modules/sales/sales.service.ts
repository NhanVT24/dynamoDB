import crypto from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateScheduleCommand, DeleteScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { env } from "../../config/env.js";
import { getShoppingItem } from "../shopping/shopping.repository.js";
import { cancelSaleCampaign, closeSaleCampaignBecauseEmpty, createSaleCampaign, getSaleCampaign, listActiveSaleCampaigns, listSaleCampaigns, transitionSaleCampaign, updateSaleCampaignProducts } from "./sales.repository.js";
import type { CreateSaleCampaignInput } from "./sales.schema.js";

const schedulerClient = new SchedulerClient({ region: env.AWS_REGION });
function scheduleName(id: string, action: "start" | "end") { return `sale-${action}-${id}`; }
function toAtExpression(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value)).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `at(${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second})`;
}

@Injectable()
export class SalesService {
  async list() { return listSaleCampaigns(); }
  async listProducts(id: string) {
    const campaign = await getSaleCampaign(id);
    if (!campaign) throw new NotFoundException("Sale campaign not found.");

    const results = await Promise.all(campaign.productIds.map((productId) => getShoppingItem(productId)));
    return {
      campaign,
      items: results.filter((product): product is NonNullable<typeof product> => Boolean(product))
    };
  }
  async create(input: CreateSaleCampaignInput) {
    const start = new Date(input.startAt); const end = new Date(input.endAt);
    if (start.getTime() <= Date.now() + 60_000 || end <= start) throw new BadRequestException("Sale must start at least one minute from now and end after it starts.");
    for (const productId of input.productIds) if (!await getShoppingItem(productId)) throw new BadRequestException(`Product ${productId} does not exist.`);
    if (!env.SALE_SCHEDULER_ROLE_ARN || !env.SALE_SCHEDULER_TARGET_ARN) throw new Error("Sale Scheduler is not configured.");
    const id = crypto.randomUUID();
    const startName = scheduleName(id, "start"); const endName = scheduleName(id, "end");
    const campaign = await createSaleCampaign({ id, name: input.name, discountPercent: input.discountPercent, startAt: input.startAt, endAt: input.endAt, productIds: input.productIds ?? [], campaignStatus: "scheduled", startScheduleName: startName, endScheduleName: endName });
    try {
      await Promise.all([this.createSchedule(campaign.id, "start", input.startAt, startName), this.createSchedule(campaign.id, "end", input.endAt, endName)]);
    } catch (error) {
      // Compensate for a partial Scheduler failure so a campaign cannot become active unexpectedly.
      await Promise.allSettled([this.deleteSchedule(startName), this.deleteSchedule(endName)]);
      await cancelSaleCampaign(campaign.id).catch(() => undefined);
      throw error;
    }
    return campaign;
  }
  async cancel(id: string) {
    const campaign = await getSaleCampaign(id); if (!campaign) throw new NotFoundException("Sale campaign not found.");
    await Promise.allSettled([this.deleteSchedule(campaign.startScheduleName), this.deleteSchedule(campaign.endScheduleName)]);
    await cancelSaleCampaign(id); return { success: true };
  }
  async removeProduct(id: string, productId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const campaign = await getSaleCampaign(id);
      if (!campaign) throw new NotFoundException("Sale campaign not found.");
      if (campaign.campaignStatus !== "scheduled" && campaign.campaignStatus !== "active") {
        throw new BadRequestException("Only scheduled or active sale campaigns can be changed.");
      }
      if (!campaign.productIds.includes(productId)) {
        return { campaign, closed: campaign.productIds.length === 0 };
      }

      const remainingProductIds = campaign.productIds.filter((id) => id !== productId);
      try {
        if (remainingProductIds.length === 0) {
          const closedCampaign = await closeSaleCampaignBecauseEmpty({
            id: campaign.id,
            expectedStatus: campaign.campaignStatus,
            expectedVersion: campaign.version
          });
          // The state is committed first; schedule deletion is cleanup and can safely be retried by AWS later.
          await Promise.allSettled([this.deleteSchedule(campaign.startScheduleName), this.deleteSchedule(campaign.endScheduleName)]);
          return { campaign: closedCampaign!, closed: true };
        }

        const updatedCampaign = await updateSaleCampaignProducts({
          id: campaign.id,
          expectedStatus: campaign.campaignStatus,
          expectedVersion: campaign.version,
          productIds: remainingProductIds
        });
        return { campaign: updatedCampaign!, closed: false };
      } catch (error) {
        const candidate = error as { name?: string };
        if (candidate?.name !== "ConditionalCheckFailedException") throw error;
      }
    }

    throw new ConflictException("Sale campaign changed at the same time. Please retry.");
  }
  async handleScheduleEvent(input: { campaignId?: string; action?: string }) {
    const campaign = await getSaleCampaign(String(input.campaignId ?? "")); if (!campaign) return { ignored: "campaign_not_found" };
    if (input.action === "start") {
      if (new Date() >= new Date(campaign.endAt)) { await transitionSaleCampaign(campaign.id, "scheduled", "ended").catch(() => undefined); return { ended: true }; }
      await transitionSaleCampaign(campaign.id, "scheduled", "active").catch(() => undefined); return { active: true };
    }
    if (input.action === "end") { await transitionSaleCampaign(campaign.id, campaign.campaignStatus === "scheduled" ? "scheduled" : "active", "ended").catch(() => undefined); return { ended: true }; }
    return { ignored: "unknown_action" };
  }
  async getActiveCampaigns() { return listActiveSaleCampaigns(); }
  private async createSchedule(campaignId: string, action: "start" | "end", at: string, name: string) {
    await schedulerClient.send(new CreateScheduleCommand({ Name: name, GroupName: env.SALE_SCHEDULER_GROUP_NAME, ScheduleExpression: toAtExpression(at), ScheduleExpressionTimezone: "Asia/Ho_Chi_Minh", FlexibleTimeWindow: { Mode: "OFF" }, ActionAfterCompletion: "DELETE", Target: { Arn: env.SALE_SCHEDULER_TARGET_ARN!, RoleArn: env.SALE_SCHEDULER_ROLE_ARN!, Input: JSON.stringify({ campaignId, action }) } }));
  }
  private async deleteSchedule(name: string) { await schedulerClient.send(new DeleteScheduleCommand({ Name: name, GroupName: env.SALE_SCHEDULER_GROUP_NAME })); }
}
