import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";
import { UploadAccess } from "./application/upload-access.js";
import { S3UploadStorage, buildPublicUrl } from "./infrastructure/s3-upload-storage.js";
@Module({
  controllers: [UploadsController],
  providers: [
    { provide: UploadAccess, useFactory: () => new UploadAccess(new S3UploadStorage()) },
    { provide: UploadsService, inject: [UploadAccess], useFactory: (access: UploadAccess) => new UploadsService(access, buildPublicUrl) }
  ],
  exports: [UploadsService]
})
export class UploadsModule {}
