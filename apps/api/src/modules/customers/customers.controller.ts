import { Controller, Get, Query } from "@nestjs/common";
import { listVerifiedCustomers } from "./cognito-customer-directory.js";
@Controller("api/admin/customers") export class CustomersController {
  @Get() list(@Query("search") search = "", @Query("limit") limit = "25") { return listVerifiedCustomers(search, Number(limit)); }
}
