#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsApiStack } from "../stack/aws-api-stack";
import { DomainHostedZoneStack } from "../stack/domain-hosted-zone-stack";
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
  apiCertificateArn: "API_CERTIFICATE_ARN",
  apiCertificateDomainName: "API_CERTIFICATE_DOMAIN_NAME",
  apiCertificateHostedZoneDomainName: "API_CERTIFICATE_HOSTED_ZONE_DOMAIN_NAME",
  apiCertificateSubjectAlternativeNames: "API_CERTIFICATE_SUBJECT_ALTERNATIVE_NAMES",
  apiCustomDomainName: "API_CUSTOM_DOMAIN_NAME",
  apiHostedZoneDomainName: "API_HOSTED_ZONE_DOMAIN_NAME",
  frontendCertificateArn: "FRONTEND_CERTIFICATE_ARN",
  frontendCertificateDomainName: "FRONTEND_CERTIFICATE_DOMAIN_NAME",
  frontendCertificateHostedZoneDomainName: "FRONTEND_CERTIFICATE_HOSTED_ZONE_DOMAIN_NAME",
  frontendCertificateSubjectAlternativeNames: "FRONTEND_CERTIFICATE_SUBJECT_ALTERNATIVE_NAMES",
  frontendDomainNames: "FRONTEND_DOMAIN_NAMES",
  frontendHostedZoneDomainName: "FRONTEND_HOSTED_ZONE_DOMAIN_NAME",
  frontendPublicAssetsOriginDomainName: "FRONTEND_PUBLIC_ASSETS_ORIGIN_DOMAIN_NAME",
  productImagesCertificateArn: "PRODUCT_IMAGES_CERTIFICATE_ARN",
  productImagesDomainNames: "PRODUCT_IMAGES_DOMAIN_NAMES",
  productImagesHostedZoneDomainName: "PRODUCT_IMAGES_HOSTED_ZONE_DOMAIN_NAME",
  route53HostedZoneDomainName: "ROUTE53_HOSTED_ZONE_DOMAIN_NAME"
};

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
const apiCertificateDomainName = readContextString("apiCertificateDomainName");
const apiCertificateHostedZoneDomainName = readContextString("apiCertificateHostedZoneDomainName");
const frontendCertificateDomainName = readContextString("frontendCertificateDomainName");
const frontendCertificateHostedZoneDomainName = readContextString("frontendCertificateHostedZoneDomainName");
const route53HostedZoneDomainName = readContextString("route53HostedZoneDomainName");

if (route53HostedZoneDomainName) {
  new DomainHostedZoneStack(app, "SupermarketDomainHostedZoneStack", {
    zoneName: route53HostedZoneDomainName,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
    }
  });
}

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

if (apiCertificateDomainName || apiCertificateHostedZoneDomainName) {
  if (!apiCertificateDomainName) {
    throw new Error("apiCertificateDomainName is required when apiCertificateHostedZoneDomainName is provided.");
  }
  if (!apiCertificateHostedZoneDomainName) {
    throw new Error("apiCertificateHostedZoneDomainName is required when apiCertificateDomainName is provided.");
  }

  new FrontendCertificateStack(app, "SupermarketApiCertificateStack", {
    domainName: apiCertificateDomainName,
    hostedZoneDomainName: apiCertificateHostedZoneDomainName,
    subjectAlternativeNames: readContextList("apiCertificateSubjectAlternativeNames"),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
    }
  });
}

new AwsApiStack(app, "SupermarketAwsStack", {
  apiCertificateArn: readContextString("apiCertificateArn"),
  apiCustomDomainName: readContextString("apiCustomDomainName"),
  apiHostedZoneDomainName: readContextString("apiHostedZoneDomainName"),
  productImagesCertificateArn: readContextString("productImagesCertificateArn"),
  productImagesDomainNames: readContextList("productImagesDomainNames"),
  productImagesHostedZoneDomainName: readContextString("productImagesHostedZoneDomainName"),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});

new FrontendCloudFrontStack(app, "SupermarketFrontendCloudFrontStack", {
  certificateArn: readContextString("frontendCertificateArn"),
  domainNames: readContextList("frontendDomainNames"),
  hostedZoneDomainName: readContextString("frontendHostedZoneDomainName"),
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
