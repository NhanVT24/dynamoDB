import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { UploadsService } from "./uploads.service.js";
import { createUploadPresignSchema } from "./uploads.schema.js";

@Controller("api/uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post("presign")
  @HttpCode(HttpStatus.CREATED)
  createPresign(@Body() rawBody: Record<string, unknown>) {
    const input = createUploadPresignSchema.parse(rawBody);
    return this.uploadsService.createPresignedUpload(input);
  }
}
