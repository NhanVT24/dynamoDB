import { Injectable } from "@nestjs/common";
import { AdminOperations } from "./application/admin-operations.js";
@Injectable()
export class AdminOpsService extends AdminOperations {}
