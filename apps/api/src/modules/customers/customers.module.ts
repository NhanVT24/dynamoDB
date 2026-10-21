import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller.js";
import { ListVerifiedCustomers } from "./application/customer-directory.js";
import { searchCustomerCandidates } from "./cognito-customer-directory.js";
@Module({ controllers: [CustomersController], providers: [{ provide: ListVerifiedCustomers, useFactory: () => new ListVerifiedCustomers({ search: searchCustomerCandidates }) }] })
export class CustomersModule {}
