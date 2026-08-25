import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { UploadsService } from "./uploads.service.js";
import { createUploadPresignSchema } from "./uploads.schema.js";

@Controller("api/uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post("presign")
  @HttpCode(HttpStatus.CREATED)
  createPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("You need a customer or admin account to upload an image.");
    }

    const input = createUploadPresignSchema.parse(rawBody);
    return this.uploadsService.createPresignedUpload(input);
  }

  @Post("avatar/presign")
  @HttpCode(HttpStatus.CREATED)
  createAvatarPresign(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      throw new ForbiddenException("You need to sign in before uploading an avatar.");
    }

    const input = createUploadPresignSchema.parse(rawBody);
    // User avatars always go to their dedicated S3 prefix, regardless of client input.
    return this.uploadsService.createPresignedUpload({ ...input, scope: "avatars" });
  }
}
