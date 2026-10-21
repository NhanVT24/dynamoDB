import { CognitoUserDirectory, dynamoAuthorizationStore } from "./infrastructure/authorization-adapters.js";
import { ProfileQueries, UpdateProfile } from "./application/profile.js";
import { DynamoProfiles, S3ProfileAvatars } from "./infrastructure/profile-adapters.js";
import { Module } from "@nestjs/common";
import { AuthorizationController } from "./authorization.controller.js";
import { AuthorizationService } from "./authorization.service.js";
import { ProfileController } from "./profile.controller.js";

@Module({
  controllers: [AuthorizationController, ProfileController],
  providers: [{ provide: AuthorizationService, useFactory: () => new AuthorizationService(new CognitoUserDirectory(), dynamoAuthorizationStore) },
    { provide: ProfileQueries, useFactory: () => new ProfileQueries(new DynamoProfiles(), new S3ProfileAvatars()) },
    { provide: UpdateProfile, inject: [ProfileQueries], useFactory: (queries: ProfileQueries) => new UpdateProfile(new DynamoProfiles(), new S3ProfileAvatars(), queries) }
  ]
})
export class AuthorizationModule {}

