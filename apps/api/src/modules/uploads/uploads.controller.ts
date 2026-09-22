import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { UploadsService } from "./uploads.service.js";
import { createReportOpenPresignSchema, createReportUploadPresignSchema, createUploadPresignSchema } from "./uploads.schema.js";

@Controller("api/uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post("presign")
  @HttpCode(HttpStatus.CREATED)
  async createPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("You need a customer or admin account to upload an image.");
    }

    const input = createUploadPresignSchema.parse(rawBody);
    return this.uploadsService.createPresignedUpload(input);
  }

  @Post("avatar/presign")
  @HttpCode(HttpStatus.CREATED)
  async createAvatarPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      throw new ForbiddenException("You need to sign in before uploading an avatar.");
    }

    const input = createUploadPresignSchema.parse(rawBody);
    // User avatars always go to their dedicated S3 prefix, regardless of client input.
    return this.uploadsService.createPresignedUpload({ ...input, scope: "avatars" });
  }

  @Get("default-avatars")
  async listDefaultAvatars() {
    return this.uploadsService.listDefaultAvatars();
  }

  @Post("default-avatars/presign")
  @HttpCode(HttpStatus.CREATED)
  async createDefaultAvatarPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || principal.role !== "admin") {
      throw new ForbiddenException("Only admin accounts can upload default avatars.");
    }

    const input = createUploadPresignSchema.parse(rawBody);
    return this.uploadsService.createDefaultAvatarUpload(input);
  }

  @Post("reports/presign")
  @HttpCode(HttpStatus.CREATED)
  async createReportPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || principal.role !== "admin") {
      throw new ForbiddenException("Only admin accounts can upload private reports.");
    }

    const input = createReportUploadPresignSchema.parse(rawBody);
    return this.uploadsService.createAdminReportUpload(input);
  }

  @Get("reports")
  async listReports(@Req() request: FastifyRequest) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || principal.role !== "admin") {
      throw new ForbiddenException("Only admin accounts can view private reports.");
    }

    return this.uploadsService.listAdminReports();
  }

  @Post("reports/open")
  @HttpCode(HttpStatus.OK)
  async createReportOpenUrl(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || principal.role !== "admin") {
      throw new ForbiddenException("Only admin accounts can open private reports.");
    }

    const input = createReportOpenPresignSchema.parse(rawBody);
    return this.uploadsService.createAdminReportOpenUrl(input);
  }

  @Post("reports/download")
  @HttpCode(HttpStatus.OK)
  async createReportDownloadUrl(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    return this.createReportOpenUrl(request, rawBody);
  }
}
