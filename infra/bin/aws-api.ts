#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsApiStack } from "../lib/aws-api-stack";

const app = new cdk.App();

new AwsApiStack(app, "SupermarketAwsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});
