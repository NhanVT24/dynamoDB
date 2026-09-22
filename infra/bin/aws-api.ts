#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsApiStack } from "../stack/aws-api-stack";
import { FrontendCertificateStack } from "../stack/frontend-certificate-stack";
import { FrontendCloudFrontStack } from "../stack/frontend-cloudfront-stack";
import { S3StorageStack } from "../stack/s3-storage-stack";

const app = new cdk.App();
const defaultFrontendApiOriginDomainName = "b5j3895qth.execute-api.ap-southeast-1.amazonaws.com";
const defaultFrontendApiOriginPath = "/prod";
const defaultFrontendPublicAssetsOriginDomainName = "supermarketawsstack-productimagesbucket03bda4c8-u88kfbwbooqy.s3.ap-southeast-1.amazonaws.com";
const contextEnvNames: Record<string, string> = {
  frontendApiOriginDomainName: "FRONTEND_API_ORIGIN_DOMAIN_NAME",
  frontendApiOriginPath: "FRONTEND_API_ORIGIN_PATH",
  frontendCertificateArn: "FRONTEND_CERTIFICATE_ARN",
  frontendCertificateDomainName: "FRONTEND_CERTIFICATE_DOMAIN_NAME",
  frontendCertificateHostedZoneDomainName: "FRONTEND_CERTIFICATE_HOSTED_ZONE_DOMAIN_NAME",
  frontendCertificateSubjectAlternativeNames: "FRONTEND_CERTIFICATE_SUBJECT_ALTERNATIVE_NAMES",
  frontendDomainNames: "FRONTEND_DOMAIN_NAMES",
  frontendPublicAssetsOriginDomainName: "FRONTEND_PUBLIC_ASSETS_ORIGIN_DOMAIN_NAME"
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
const frontendCertificateDomainName = readContextString("frontendCertificateDomainName");
const frontendCertificateHostedZoneDomainName = readContextString("frontendCertificateHostedZoneDomainName");

if (frontendCertificateDomainName || frontendCertificateHostedZoneDomainName) {
  if (!frontendCertificateDomainName) {
    throw new Error("frontendCertificateDomainName is required when frontendCertificateHostedZoneDomainName is provided.");
  }
  if (!frontendCertificateHostedZoneDomainName) {
    throw new Error("frontendCertificateHostedZoneDomainName is required when frontendCertificateDomainName is provided.");
  }

  new FrontendCertificateStack(app, "SupermarketFrontendCertificateStack", {
    domainName: frontendCertificateDomainName,
    hostedZoneDomainName: frontendCertificateHostedZoneDomainName,
    subjectAlternativeNames: readContextList("frontendCertificateSubjectAlternativeNames"),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: "us-east-1"
    }
  });
}

new FrontendCloudFrontStack(app, "SupermarketFrontendCloudFrontStack", {
  certificateArn: readContextString("frontendCertificateArn"),
  domainNames: readContextList("frontendDomainNames"),
  publicAssetsOriginDomainName: readContextString("frontendPublicAssetsOriginDomainName") ?? defaultFrontendPublicAssetsOriginDomainName,
  apiOriginDomainName: readContextString("frontendApiOriginDomainName") ?? defaultFrontendApiOriginDomainName,
  apiOriginPath: frontendApiOriginPath?.startsWith("/") ? frontendApiOriginPath : frontendApiOriginPath ? `/${frontendApiOriginPath}` : defaultFrontendApiOriginPath,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});

new S3StorageStack(app, "SupermarketS3StorageStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});
