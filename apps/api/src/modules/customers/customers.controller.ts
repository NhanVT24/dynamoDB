import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ListVerifiedCustomers } from "./application/customer-directory.js";
@Controller("api/admin/customers")
export class CustomersController {
 constructor(@Inject(ListVerifiedCustomers) private readonly query: ListVerifiedCustomers) {}
 @Get() list(@Query("search") search = "", @Query("limit") limit = "25") { return this.query.execute(search, Number(limit)); }
}
