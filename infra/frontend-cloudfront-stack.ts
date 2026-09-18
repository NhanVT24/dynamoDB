import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface FrontendCloudFrontStackProps extends StackProps {
  readonly certificateArn?: string;
  readonly domainNames?: string[];
  readonly apiOriginDomainName?: string;
  readonly apiOriginPath?: string;
}

export class FrontendCloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendCloudFrontStackProps = {}) {
    super(scope, id, props);

    const domainNames = props.domainNames ?? [];
    if (domainNames.length > 0 && !props.certificateArn) {
      throw new Error("certificateArn is required when domainNames is provided for CloudFront.");
    }

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      lifecycleRules: [
        {
          id: "ExpireRetainedNextStaticAssets",
          prefix: "_next/static/",
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(30)
        }
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const spaRewriteFunction = new cloudfront.Function(this, "FrontendSpaRewriteFunction", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.startsWith("/store/products/") && !uri.startsWith("/store/products/detail/") && !uri.includes(".")) {
    var slug = uri.substring("/store/products/".length).replace(/\\/+$/, "");
    return {
      statusCode: 302,
      statusDescription: "Found",
      headers: {
        location: { value: "/store/products/detail/?slug=" + encodeURIComponent(slug) }
      }
    };
  }

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  if (!uri.includes(".") && !uri.startsWith("/api/")) {
    request.uri = uri + "/index.html";
  }

  return request;
}
`)
    });

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "FrontendCertificate", props.certificateArn)
      : undefined;

    const frontendOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);
    const htmlCachePolicy = new cloudfront.CachePolicy(this, "FrontendHtmlCachePolicy", {
      comment: "Short-lived cache policy for frontend HTML documents",
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(5),
      minTtl: Duration.seconds(0),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none()
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      comment: "Experimental static frontend hosting for Supermarket web app",
      defaultRootObject: "index.html",
      certificate,
      domainNames: domainNames.length > 0 ? domainNames : undefined,
      defaultBehavior: {
        origin: frontendOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: htmlCachePolicy,
        compress: true,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: spaRewriteFunction
        }],
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1)
        }
      ],
      enableIpv6: true,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200
    });

    distribution.addBehavior(
      "/_next/static/*",
      frontendOrigin,
      {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      }
    );

    if (props.apiOriginDomainName) {
      const apiProxyRewriteFunction = new cloudfront.Function(this, "ApiProxyRewriteFunction", {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var prefix = "/api/lambda-proxy";

  if (request.uri === prefix) {
    request.uri = "/";
    return request;
  }

  if (request.uri.startsWith(prefix + "/")) {
    request.uri = request.uri.substring(prefix.length);
  }

  return request;
}
`)
      });

      distribution.addBehavior(
        "/api/lambda-proxy/*",
        new origins.HttpOrigin(props.apiOriginDomainName, {
          originPath: props.apiOriginPath ?? "/prod",
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        }),
        {
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          functionAssociations: [{
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: apiProxyRewriteFunction
          }],
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
        }
      );
    }

    new CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName
    });

    new CfnOutput(this, "FrontendDistributionId", {
      value: distribution.distributionId
    });

    new CfnOutput(this, "FrontendDistributionDomainName", {
      value: distribution.distributionDomainName
    });
  }
}
