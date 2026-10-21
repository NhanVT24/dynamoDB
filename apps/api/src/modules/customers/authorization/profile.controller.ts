import { normalizeAddresses, userAddressSchema } from "./user-address.js";
import { BadRequestException, Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRequestPrincipal } from "../../../common/auth/request-principal.js";
import { ProfileQueries, UpdateProfile } from "./application/profile.js";

const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarKey: z.string().max(500).optional(),
  addresses: z.array(userAddressSchema).max(10).optional()
}).strict().refine((value) => Object.keys(value).length > 0);


@Controller("api/profile")
export class ProfileController {
  constructor(@Inject(ProfileQueries) private readonly queries: ProfileQueries,
    @Inject(UpdateProfile) private readonly update: UpdateProfile) {}
  @Get("me")
  async getMe(@Req() request: FastifyRequest) {
    const principal = await requireRequestPrincipal(request, { message: "A signed-in account is required." });
    return this.queries.get(principal.subject);
  }
  @Patch("me")
  async updateMe(@Req() request: FastifyRequest, @Body() body: unknown) {
    const principal = await requireRequestPrincipal(request, { message: "A signed-in account is required." });
    const parsed = profilePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid profile update.");
    return this.update.execute(principal.subject, { ...parsed.data,
      addresses: parsed.data.addresses === undefined ? undefined : normalizeAddresses(parsed.data.addresses) });
  }
}
