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
  readonly publicAssetsOriginDomainName?: string;
  readonly apiOriginDomainName?: string;
  readonly apiOriginPath?: string;
}

function normalizeOriginDomainName(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
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
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, function (character) {
    return ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character];
  });
}

function isProductPreviewBot(request) {
  var userAgentHeader = request.headers["user-agent"];
  var userAgent = userAgentHeader && userAgentHeader.value ? userAgentHeader.value.toLowerCase() : "";
  return userAgent.indexOf("facebookexternalhit") >= 0 ||
    userAgent.indexOf("facebot") >= 0 ||
    userAgent.indexOf("twitterbot") >= 0 ||
    userAgent.indexOf("slackbot") >= 0 ||
    userAgent.indexOf("discordbot") >= 0 ||
    userAgent.indexOf("telegrambot") >= 0 ||
    userAgent.indexOf("zalo") >= 0 ||
    userAgent.indexOf("linkedinbot") >= 0;
}

function titleFromProductSlug(slug) {
  var withoutUuid = slug.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "");
  var words = decodeURIComponent(withoutUuid).split(/[-_]+/).filter(Boolean);
  if (words.length === 0) {
    return "Product detail";
  }
  return words.map(function (word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

function productPreviewResponse(request, slug) {
  var hostHeader = request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value : "";
  var canonicalUrl = "https://" + host + request.uri;
  var productTitle = titleFromProductSlug(slug);
  var pageTitle = productTitle + " | NovaX Market";
  var description = "View product details, availability, and checkout options for " + productTitle + ".";
  var safeTitle = escapeHtml(pageTitle);
  var safeDescription = escapeHtml(description);
  var safeUrl = escapeHtml(canonicalUrl);

  return {
    statusCode: 200,
    statusDescription: "OK",
    headers: {
      "content-type": { value: "text/html; charset=utf-8" },
      "cache-control": { value: "public, max-age=300" }
    },
    body: "<!doctype html><html><head>" +
      "<meta charset=\\"utf-8\\">" +
      "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">" +
      "<title>" + safeTitle + "</title>" +
      "<meta name=\\"description\\" content=\\"" + safeDescription + "\\">" +
      "<meta property=\\"og:type\\" content=\\"product\\">" +
      "<meta property=\\"og:title\\" content=\\"" + safeTitle + "\\">" +
      "<meta property=\\"og:description\\" content=\\"" + safeDescription + "\\">" +
      "<meta property=\\"og:url\\" content=\\"" + safeUrl + "\\">" +
      "<meta name=\\"twitter:card\\" content=\\"summary\\">" +
      "<meta name=\\"twitter:title\\" content=\\"" + safeTitle + "\\">" +
      "<meta name=\\"twitter:description\\" content=\\"" + safeDescription + "\\">" +
      "<link rel=\\"canonical\\" href=\\"" + safeUrl + "\\">" +
      "</head><body><a href=\\"" + safeUrl + "\\">" + safeTitle + "</a></body></html>"
  };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.startsWith("/store/products/") && !uri.startsWith("/store/products/detail/") && !uri.includes(".")) {
    var slug = uri.substring("/store/products/".length).replace(/\\/+$/, "");
    if (!slug) {
      request.uri = "/store/products/index.html";
      return request;
    }
    if (isProductPreviewBot(request)) {
      return productPreviewResponse(request, slug);
    }
    request.uri = "/store/products/detail/index.html";
    return request;
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

    if (props.publicAssetsOriginDomainName) {
      const publicAssetsOrigin = new origins.HttpOrigin(
        normalizeOriginDomainName(props.publicAssetsOriginDomainName),
        {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        }
      );

      const adminPublicAssetsRewriteFunction = new cloudfront.Function(this, "AdminPublicAssetsRewriteFunction", {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var prefix = "/admin";

  if (request.uri.startsWith(prefix + "/public/")) {
    request.uri = request.uri.substring(prefix.length);
  }

  return request;
}
`)
      });

      const publicAssetsBehavior: cloudfront.AddBehaviorOptions = {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      };

      distribution.addBehavior(
        "/public/*",
        publicAssetsOrigin,
        publicAssetsBehavior
      );

      distribution.addBehavior(
        "/admin/public/*",
        publicAssetsOrigin,
        {
          ...publicAssetsBehavior,
          functionAssociations: [{
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: adminPublicAssetsRewriteFunction
          }]
        }
      );
    }

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
