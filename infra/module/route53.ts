import { Stack } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";

// Keep DNS records under the existing stack to preserve their logical IDs.
export function createProductImagesAliases(
  scope: Stack,
  productImagesDistribution: cloudfront.IDistribution,
  productImagesDomainNames: string[],
  hostedZoneDomainName?: string
) {
  if (productImagesDomainNames.length > 0 && hostedZoneDomainName) {
    const productImagesHostedZone = route53.HostedZone.fromLookup(scope, "ProductImagesHostedZone", {
      domainName: hostedZoneDomainName
    });
    // Route53 Alias A/AAAA points the assets hostname at the CloudFront
    // distribution. This behaves like a CNAME to CloudFront but also works
    // with AWS alias targets and supports IPv6 via AAAA.
    const productImagesTarget = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(productImagesDistribution));

    productImagesDomainNames.forEach((domainName, index) => {
      new route53.ARecord(scope, `ProductImagesAliasARecord${index + 1}`, {
        zone: productImagesHostedZone,
        recordName: domainName,
        target: productImagesTarget
      });
      new route53.AaaaRecord(scope, `ProductImagesAliasAaaaRecord${index + 1}`, {
        zone: productImagesHostedZone,
        recordName: domainName,
        target: productImagesTarget
      });
    });
  }
}

export function createApiAliases(
  scope: Stack,
  apiCustomDomain: apigateway.DomainName,
  domainName: string,
  hostedZoneDomainName: string
): void {
  const apiHostedZone = route53.HostedZone.fromLookup(scope, "ApiHostedZone", {
    domainName: hostedZoneDomainName
  });
  // Alias A/AAAA points the custom domain at the regional API Gateway endpoint.
  const apiTarget = route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(apiCustomDomain));

  new route53.ARecord(scope, "ApiAliasARecord", {
    zone: apiHostedZone,
    recordName: domainName,
    target: apiTarget
  });
  new route53.AaaaRecord(scope, "ApiAliasAaaaRecord", {
    zone: apiHostedZone,
    recordName: domainName,
    target: apiTarget
  });
}
