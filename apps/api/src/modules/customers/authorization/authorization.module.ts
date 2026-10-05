import { Module } from "@nestjs/common";
import { AuthorizationController } from "./authorization.controller.js";
import { AuthorizationService } from "./authorization.service.js";
import { ProfileController } from "./profile.controller.js";

@Module({
  controllers: [AuthorizationController, ProfileController],
  providers: [AuthorizationService]
})
export class AuthorizationModule {}

