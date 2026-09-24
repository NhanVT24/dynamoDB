import { Stack } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface ProductImagesCdnOptions {
  readonly certificateArn?: string;
  readonly domainNames?: string[];
}

// Create CloudFront resources under the existing stack to preserve logical IDs.
export function createProductImagesDistribution(
  scope: Stack,
  productImagesBucket: s3.IBucket,
  options: ProductImagesCdnOptions
) {
  const productImagesDomainNames = options.domainNames ?? [];
  if (productImagesDomainNames.length > 0 && !options.certificateArn) {
    throw new Error("productImagesCertificateArn is required when productImagesDomainNames is provided.");
  }

  const productImagesPublicOnlyFunction = new cloudfront.Function(scope, "ProductImagesPublicOnlyFunction", {
    code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf("/public/") !== 0) {
    return {
      statusCode: 403,
      statusDescription: "Forbidden",
      headers: {
        "cache-control": { value: "no-store" },
        "content-type": { value: "text/plain; charset=utf-8" }
      },
      body: "Forbidden"
    };
  }

  return request;
}
`)
  });

  // CloudFront terminates HTTPS for assets.truyenmasinhvien.com and reads
  // from the S3 bucket through Origin Access Control.
  const productImagesCertificate = options.certificateArn
    ? acm.Certificate.fromCertificateArn(scope, "ProductImagesCertificate", options.certificateArn)
    : undefined;

  // Public asset flow:
  // browser -> assets.truyenmasinhvien.com -> Route53 Alias -> CloudFront -> S3 bucket.
  const productImagesDistribution = new cloudfront.Distribution(scope, "ProductImagesDistribution", {
    comment: "Public CDN endpoint for product images and uploaded public assets",
    certificate: productImagesCertificate,
    domainNames: productImagesDomainNames.length > 0 ? productImagesDomainNames : undefined,
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(productImagesBucket),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      functionAssociations: [{
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        function: productImagesPublicOnlyFunction
      }],
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
    },
    enableIpv6: true,
    priceClass: cloudfront.PriceClass.PRICE_CLASS_200
  });

  // API responses store/render fileUrl from this base URL. With a custom
  // assets domain, new public files become
  // https://assets.truyenmasinhvien.com/public/...
  const productImagesPublicBaseUrl = productImagesDomainNames.length > 0
    ? `https://${productImagesDomainNames[0]}`
    : `https://${productImagesDistribution.distributionDomainName}`;

  return {
    productImagesDistribution,
    productImagesDomainNames,
    productImagesPublicBaseUrl
  };
}
