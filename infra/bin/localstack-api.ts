#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LocalstackApiStack } from "../lib/localstack-api-stack";

const app = new cdk.App();

new LocalstackApiStack(app, "SupermarketApiLocalStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? "000000000000",
    region: "ap-southeast-1"
  }
});
