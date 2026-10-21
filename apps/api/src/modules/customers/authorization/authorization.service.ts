import { Injectable } from "@nestjs/common";
import { AuthorizationUseCases } from "./application/authorization.js";
/** Compatibility facade for HTTP callers; dependencies are wired by the module. */
@Injectable()
export class AuthorizationService extends AuthorizationUseCases {}
