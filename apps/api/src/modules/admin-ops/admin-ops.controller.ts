import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AdminOpsService } from "./admin-ops.service.js";

const dlqQueueSchema = z.enum(["notifications", "storefrontOrders", "paymentEvents", "imageUploads", "eventbridgeTargets"]);
const archiveKeySchema = z.enum(["commerce", "payment", "platform"]);

const listDlqQuerySchema = z.object({
  queue: dlqQueueSchema.optional(),
  maxMessages: z.coerce.number().int().min(1).max(10).optional()
});

const replayDlqBodySchema = z.object({
  queue: dlqQueueSchema.optional(),
  maxMessages: z.coerce.number().int().min(1).max(10).optional(),
  dryRun: z.coerce.boolean().optional(),
  messageIds: z.array(z.string().min(1)).max(10).optional()
});

const startArchiveReplayBodySchema = z.object({
  replayName: z.string().min(1).max(64).optional(),
  eventStartTime: z.string().min(1),
  eventEndTime: z.string().min(1),
  ruleArns: z.array(z.string().min(1)).max(5).optional(),
  description: z.string().max(512).optional()
});

const replayNameParamSchema = z.object({
  replayName: z.string().min(1)
});

@Controller("api/admin/ops")
export class AdminOpsController {
  constructor(private readonly adminOpsService: AdminOpsService) {}

  @Get("archives")
  listArchives() {
    return this.adminOpsService.listArchives();
  }

  @Post("archives/:archive/replay")
  startArchiveReplay(@Param() rawParams: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const params = z.object({ archive: archiveKeySchema }).parse(rawParams);
    const body = startArchiveReplayBodySchema.parse(rawBody);
    return this.adminOpsService.startArchiveReplay({
      archive: params.archive,
      replayName: body.replayName,
      eventStartTime: body.eventStartTime,
      eventEndTime: body.eventEndTime,
      ruleArns: body.ruleArns,
      description: body.description
    });
  }

  @Get("archives/replays/:replayName")
  getArchiveReplayStatus(@Param() rawParams: Record<string, string>) {
    const params = replayNameParamSchema.parse(rawParams);
    return this.adminOpsService.getArchiveReplayStatus(params.replayName);
  }

  @Get("dlq")
  listDlqMessages(@Query() rawQuery: Record<string, unknown>) {
    const query = listDlqQuerySchema.parse(rawQuery);
    return this.adminOpsService.listDlqMessages(query.queue, query.maxMessages ?? 5);
  }

  @Post("dlq/replay")
  replayDlqMessages(@Body() rawBody: Record<string, unknown>) {
    const body = replayDlqBodySchema.parse(rawBody);
    return this.adminOpsService.replayDlqMessages({
      queue: body.queue,
      maxMessages: body.maxMessages ?? 5,
      dryRun: body.dryRun ?? false,
      messageIds: body.messageIds
    });
  }
}
