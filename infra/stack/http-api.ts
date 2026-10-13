import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Stack } from "aws-cdk-lib";
import { createApiAliases } from "../module/route53";

export type HttpApiConfig = {
  apiCertificateArn?: string;
  apiCustomDomainName?: string;
  apiHostedZoneDomainName?: string;
};

// Resources are deliberately created with `scope` as their parent rather than
// a nested Construct. Keeping both parent and IDs unchanged preserves CDK
// logical IDs during this source-only refactor.
export function createHttpApi(scope: Stack, input: {
  config: HttpApiConfig;
  handler: lambda.IFunction;
  userPool: cognito.IUserPool;
}) {
  const api = new apigateway.RestApi(scope, "SupermarketApiGateway", {
    defaultCorsPreflightOptions: {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ["Authorization", "Content-Type"]
    }
  });
  const integration = new apigateway.LambdaIntegration(input.handler);
  const authorizer = new apigateway.CognitoUserPoolsAuthorizer(scope, "SupermarketApiAuthorizer", {
    cognitoUserPools: [input.userPool]
  });
  const publicMethod = { authorizationType: apigateway.AuthorizationType.NONE };

  api.root.addMethod("GET", integration, publicMethod);
  api.root.addResource("health").addMethod("GET", integration, publicMethod);

  const apiResource = api.root.addResource("api");
  const products = apiResource.addResource("products");
  products.addMethod("ANY", integration, publicMethod);
  products.addResource("{proxy+}").addMethod("ANY", integration, publicMethod);

  const storefront = apiResource.addResource("storefront");
  const storefrontProducts = storefront.addResource("products");
  storefrontProducts.addMethod("ANY", integration, publicMethod);
  storefrontProducts.addResource("{proxy+}").addMethod("ANY", integration, publicMethod);
  const orders = storefront.addResource("orders");
  orders.addMethod("POST", integration, publicMethod);
  orders.addResource("me").addMethod("GET", integration, publicMethod);
  storefront.addResource("{proxy+}").addMethod("ANY", integration, publicMethod);

  for (const name of ["notifications", "uploads"]) {
    const resource = apiResource.addResource(name);
    resource.addMethod("ANY", integration, publicMethod);
    resource.addResource("{proxy+}").addMethod("ANY", integration, publicMethod);
  }
  const payments = apiResource.addResource("payments").addResource("vnpay");
  payments.addMethod("ANY", integration, publicMethod);
  payments.addResource("{proxy+}").addMethod("ANY", integration, publicMethod);

  api.root.addResource("{proxy+}").addMethod("ANY", integration, {
    authorizer,
    authorizationType: apigateway.AuthorizationType.COGNITO,
    authorizationScopes: ["supermarket-api/access"]
  });

  const certificate = input.config.apiCertificateArn
    ? acm.Certificate.fromCertificateArn(scope, "ApiCertificate", input.config.apiCertificateArn)
    : undefined;
  const customDomain = input.config.apiCustomDomainName && certificate
    ? new apigateway.DomainName(scope, "ApiCustomDomain", {
      domainName: input.config.apiCustomDomainName,
      certificate,
      endpointType: apigateway.EndpointType.REGIONAL,
      securityPolicy: apigateway.SecurityPolicy.TLS_1_2
    })
    : undefined;
  if (customDomain) {
    new apigateway.BasePathMapping(scope, "ApiCustomDomainBasePathMapping", {
      domainName: customDomain,
      restApi: api,
      stage: api.deploymentStage
    });
    if (input.config.apiHostedZoneDomainName && input.config.apiCustomDomainName) {
      createApiAliases(scope, customDomain, input.config.apiCustomDomainName, input.config.apiHostedZoneDomainName);
    }
  }
  return api;
}
