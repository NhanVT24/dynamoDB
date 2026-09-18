#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsApiStack } from "../aws-api-stack";
import { FrontendCloudFrontStack } from "../frontend-cloudfront-stack";

const app = new cdk.App();
const defaultFrontendApiOriginDomainName = "rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com";
const defaultFrontendApiOriginPath = "/prod";
const contextEnvNames: Record<string, string> = {
  frontendApiOriginDomainName: "FRONTEND_API_ORIGIN_DOMAIN_NAME",
  frontendApiOriginPath: "FRONTEND_API_ORIGIN_PATH",
  frontendCertificateArn: "FRONTEND_CERTIFICATE_ARN",
  frontendDomainNames: "FRONTEND_DOMAIN_NAMES"
};

new AwsApiStack(app, "SupermarketAwsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});

function readContextList(name: string): string[] {
  const value = app.node.tryGetContext(name) ?? process.env[contextEnvNames[name] ?? name.toUpperCase()];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readContextString(name: string): string | undefined {
  const value = app.node.tryGetContext(name) ?? process.env[contextEnvNames[name] ?? name.toUpperCase()];
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

const frontendApiOriginPath = readContextString("frontendApiOriginPath");

new FrontendCloudFrontStack(app, "SupermarketFrontendCloudFrontStack", {
  certificateArn: readContextString("frontendCertificateArn"),
  domainNames: readContextList("frontendDomainNames"),
  apiOriginDomainName: readContextString("frontendApiOriginDomainName") ?? defaultFrontendApiOriginDomainName,
  apiOriginPath: frontendApiOriginPath?.startsWith("/") ? frontendApiOriginPath : frontendApiOriginPath ? `/${frontendApiOriginPath}` : defaultFrontendApiOriginPath,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});
