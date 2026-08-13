import * as path from "node:path";
import {
  CfnDynamicReference,
  CfnDynamicReferenceService,
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class AwsApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const callbackUrl = new CfnParameter(this, "CallbackUrl", {
      type: "String",
      default: "http://localhost:3000/auth/callback",
      description: "Frontend callback URL after Cognito sign-in"
    });

    const logoutUrl = new CfnParameter(this, "LogoutUrl", {
      type: "String",
      default: "http://localhost:3000/",
      description: "Frontend logout redirect URL after Cognito sign-out"
    });

    const cognitoDomainPrefix = new CfnParameter(this, "CognitoDomainPrefix", {
      type: "String",
      default: "replace-me-supermarket-auth",
      allowedPattern: "^[a-z0-9-]+$",
      description: "Globally unique domain prefix for Cognito hosted UI"
    });

    const googleClientIdSsmPath = new CfnParameter(this, "GoogleClientIdSsmPath", {
      type: "String",
      default: "/supermarket/google/client-id",
      description: "SSM parameter path for Google OAuth client id"
    });

    const vnpayTmnCodeSsmPath = new CfnParameter(this, "VnpayTmnCodeSsmPath", {
      type: "String",
      default: "/supermarket/vnpay/tmn-code",
      description: "SSM parameter path for VNPay terminal code"
    });

    const vnpayPaymentUrlSsmPath = new CfnParameter(this, "VnpayPaymentUrlSsmPath", {
      type: "String",
      default: "/supermarket/vnpay/payment-url",
      description: "SSM parameter path for VNPay payment gateway URL"
    });

    const googleClientSecret = new CfnParameter(this, "GoogleClientSecret", {
      type: "String",
      default: "",
      noEcho: true,
      description: "Google OAuth client secret for Cognito social sign-in"
    });

    const dynamoTableName = new CfnParameter(this, "DynamoTableName", {
      type: "String",
      default: "MarketplaceProductsDev",
      description: "DynamoDB table name for this stack"
    });

    const vnpayHashSecret = new CfnParameter(this, "VnpayHashSecret", {
      type: "String",
      default: "CHLZOLUIWEKQEKXUJVWWBBRPSHAAOGBB",
      noEcho: true,
      description: "VNPay sandbox hash secret"
    });

    const vnpayReturnUrl = new CfnParameter(this, "VnpayReturnUrl", {
      type: "String",
      default: "http://localhost:3000/store/checkout/result",
      description: "Frontend return URL after VNPay payment"
    });

    const vnpayIpnUrl = new CfnParameter(this, "VnpayIpnUrl", {
      type: "String",
      default: "https://rrt1ukhcpj.execute-api.ap-southeast-1.amazonaws.com/prod/api/payments/vnpay/ipn",
      description: "VNPay IPN callback URL"
    });

    const sesFromEmail = new CfnParameter(this, "SesFromEmail", {
      type: "String",
      default: "nhan18072020@gmail.com",
      description: "Verified SES sender email address"
    });

    const table = new dynamodb.CfnTable(this, "MarketplaceProductsTable", {
      tableName: dynamoTableName.valueAsString,
      billingMode: "PAY_PER_REQUEST",
      attributeDefinitions: [
        { attributeName: "PK", attributeType: "S" },
        { attributeName: "SK", attributeType: "S" },
        { attributeName: "category", attributeType: "S" },
        { attributeName: "status", attributeType: "S" },
        { attributeName: "searchName", attributeType: "S" },
        { attributeName: "searchField", attributeType: "S" },
        { attributeName: "updatedAt", attributeType: "S" }
      ],
      keySchema: [
        { attributeName: "PK", keyType: "HASH" },
        { attributeName: "SK", keyType: "RANGE" }
      ],
      globalSecondaryIndexes: [
        {
          indexName: "CategoryStatusNameIndex",
          keySchema: [
            { attributeName: "category", keyType: "HASH" },
            { attributeName: "status", keyType: "RANGE" },
            { attributeName: "searchName", keyType: "RANGE" },
            { attributeName: "PK", keyType: "RANGE" }
          ],
          projection: { projectionType: "ALL" }
        },
        {
          indexName: "StatusTimelineIndex",
          keySchema: [
            { attributeName: "status", keyType: "HASH" },
            { attributeName: "updatedAt", keyType: "RANGE" },
            { attributeName: "searchName", keyType: "RANGE" },
            { attributeName: "PK", keyType: "RANGE" }
          ],
          projection: { projectionType: "ALL" }
        },
        {
          indexName: "SearchNameIndex",
          keySchema: [
            { attributeName: "searchField", keyType: "HASH" },
            { attributeName: "searchName", keyType: "RANGE" },
            { attributeName: "PK", keyType: "RANGE" }
          ],
          projection: { projectionType: "ALL" }
        }
      ]
    });
    table.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const productImagesBucket = new s3.Bucket(this, "ProductImagesBucket", {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false
      }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: true,
      cors: [
        {
          allowedOrigins: ["*"],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000
        }
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const notificationsQueue = new sqs.Queue(this, "NotificationsQueue", {
      queueName: "supermarket-notifications",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4)
    });

    const auditQueue = new sqs.Queue(this, "AuditQueue", {
      queueName: "supermarket-audit-log",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4)
    });

    const storefrontOrdersDlq = new sqs.Queue(this, "StorefrontOrdersDlq", {
      queueName: "supermarket-storefront-orders-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const storefrontOrdersQueue = new sqs.Queue(this, "StorefrontOrdersQueue", {
      queueName: "supermarket-storefront-orders",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: storefrontOrdersDlq,
        maxReceiveCount: 3
      }
    });

    const paymentEventsDlq = new sqs.Queue(this, "PaymentEventsDlq", {
      queueName: "supermarket-payment-events-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const paymentEventsQueue = new sqs.Queue(this, "PaymentEventsQueue", {
      queueName: "supermarket-payment-events",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: paymentEventsDlq,
        maxReceiveCount: 3
      }
    });

    const cognitoTriggerFunction = new lambda.Function(this, "CognitoTriggerFunction", {
      functionName: "supermarket-cognito-trigger",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      handler: "index.handler",
      timeout: Duration.seconds(10),
      memorySize: 256,
      code: lambda.Code.fromInline(`
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminAddUserToGroupCommand,
  AdminLinkProviderForUserCommand,
  AdminListGroupsForUserCommand,
  AdminGetUserCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getAttribute(attributes, name) {
  return (attributes || []).find((attribute) => attribute.Name === name)?.Value || "";
}

function parseProviderUserName(userName) {
  const [providerName, ...rest] = String(userName || "").split("_");
  return {
    providerName,
    providerUserId: rest.join("_")
  };
}

async function findExistingUserByEmail(userPoolId, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const response = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: \`email = "\${normalizedEmail.replace(/"/g, '\\\\"')}"\`,
    Limit: 10
  }));

  const users = response.Users || [];
  return users.find((user) => String(user.Username || "").toLowerCase() !== "") || null;
}

async function handlePreSignUp(event) {
  if (event.triggerSource !== "PreSignUp_ExternalProvider") {
    return event;
  }

  const email = normalizeEmail(event.request.userAttributes.email);
  const { providerName, providerUserId } = parseProviderUserName(event.userName);

  if (!email || !providerName || !providerUserId) {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  const existingUser = await findExistingUserByEmail(event.userPoolId, email);

  if (existingUser && !String(existingUser.Username || "").startsWith(providerName + "_")) {
    await client.send(new AdminLinkProviderForUserCommand({
      UserPoolId: event.userPoolId,
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: existingUser.Username
      },
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: providerUserId
      }
    }));
  }

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}

async function handleTokenGeneration(event) {
  const user = await client.send(new AdminGetUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groupsResponse = await client.send(new AdminListGroupsForUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groups = (groupsResponse.Groups || []).map((group) => String(group.GroupName || "").toLowerCase());
  const role = groups.includes("admin") ? "admin" : groups.includes("customer") ? "customer" : "customer";
  const email = normalizeEmail(getAttribute(user.UserAttributes, "email"));
  const displayName = getAttribute(user.UserAttributes, "name") || email || "Cognito User";
  const identitiesRaw = getAttribute(user.UserAttributes, "identities");

  let authProvider = "COGNITO";
  if (identitiesRaw) {
    try {
      const identities = JSON.parse(identitiesRaw);
      authProvider = String(identities?.[0]?.providerName || "COGNITO").toUpperCase();
    } catch {}
  }

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        role,
        auth_provider: authProvider,
        principal_email: email,
        display_name: displayName
      },
      groupOverrideDetails: {
        groupsToOverride: groups.length > 0 ? groups : ["customer"]
      }
    }
  };

  return event;
}

async function handlePostConfirmation(event) {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  await client.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: "customer"
  }));

  return event;
}

exports.handler = async (event) => {
  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    return handlePreSignUp(event);
  }

  if (event.triggerSource === "PostConfirmation_ConfirmSignUp") {
    return handlePostConfirmation(event);
  }

  if (String(event.triggerSource || "").startsWith("TokenGeneration_")) {
    return handleTokenGeneration(event);
  }

  return event;
};
      `),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            "cognito-idp:AdminGetUser",
            "cognito-idp:AdminAddUserToGroup",
            "cognito-idp:AdminLinkProviderForUser",
            "cognito-idp:AdminListGroupsForUser",
            "cognito-idp:ListUsers"
          ],
          resources: ["*"]
        })
      ]
    });

    const userPool = new cognito.UserPool(this, "AdminUserPool", {
      userPoolName: "supermarket-admin-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true }
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false
      },
      lambdaTriggers: {
        preSignUp: cognitoTriggerFunction,
        postConfirmation: cognitoTriggerFunction,
        preTokenGeneration: cognitoTriggerFunction
      }
    });

    const customerGroup = new cognito.CfnUserPoolGroup(this, "CustomerGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "customer",
      description: "Customers can browse products and place orders"
    });

    const googleClientId = new CfnDynamicReference(
      CfnDynamicReferenceService.SSM,
      googleClientIdSsmPath.valueAsString
    ).toString();

    const googleIdentityProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdentityProvider", {
      userPool,
      clientId: googleClientId,
      clientSecretValue: SecretValue.unsafePlainText(googleClientSecret.valueAsString),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        fullname: cognito.ProviderAttribute.GOOGLE_NAME
      }
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "supermarket-web-client",
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [callbackUrl.valueAsString],
        logoutUrls: [logoutUrl.valueAsString]
      }
    });
    userPoolClient.node.addDependency(googleIdentityProvider);

    const vnpayTmnCodeValue = new CfnDynamicReference(
      CfnDynamicReferenceService.SSM,
      vnpayTmnCodeSsmPath.valueAsString
    ).toString();

    const vnpayPaymentUrlValue = new CfnDynamicReference(
      CfnDynamicReferenceService.SSM,
      vnpayPaymentUrlSsmPath.valueAsString
    ).toString();

    const userPoolDomain = userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix: cognitoDomainPrefix.valueAsString }
    });

    const lambdaFunction = new lambda.Function(this, "SupermarketApiFunction", {
      functionName: "supermarket-api-aws",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      handler: "src/lambda.handler",
      timeout: Duration.seconds(10),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda.zip")),
      environment: {
        DYNAMODB_TABLE_NAME: table.tableName ?? dynamoTableName.valueAsString,
        S3_BUCKET_NAME: productImagesBucket.bucketName,
        S3_PUBLIC_BASE_URL: `https://${productImagesBucket.bucketName}.s3.${this.region}.amazonaws.com`,
        SQS_NOTIFICATIONS_QUEUE_URL: notificationsQueue.queueUrl,
        SQS_AUDIT_QUEUE_URL: auditQueue.queueUrl,
        SQS_PAYMENT_EVENTS_QUEUE_URL: paymentEventsQueue.queueUrl,
        SQS_STOREFRONT_ORDERS_QUEUE_URL: storefrontOrdersQueue.queueUrl,
        SES_FROM_EMAIL: sesFromEmail.valueAsString,
        VNPAY_TMN_CODE: vnpayTmnCodeValue,
        VNPAY_HASH_SECRET: vnpayHashSecret.valueAsString,
        VNPAY_PAYMENT_URL: vnpayPaymentUrlValue,
        VNPAY_RETURN_URL: vnpayReturnUrl.valueAsString,
        VNPAY_IPN_URL: vnpayIpnUrl.valueAsString
      }
    });

    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem"
      ],
      resources: [
        table.attrArn,
        `${table.attrArn}/index/*`
      ]
    }));

    productImagesBucket.grantReadWrite(lambdaFunction);
    notificationsQueue.grantSendMessages(lambdaFunction);
    notificationsQueue.grantConsumeMessages(lambdaFunction);
    auditQueue.grantSendMessages(lambdaFunction);
    storefrontOrdersQueue.grantSendMessages(lambdaFunction);
    storefrontOrdersQueue.grantConsumeMessages(lambdaFunction);
    storefrontOrdersDlq.grantConsumeMessages(lambdaFunction);
    paymentEventsQueue.grantSendMessages(lambdaFunction);
    paymentEventsQueue.grantConsumeMessages(lambdaFunction);
    paymentEventsDlq.grantConsumeMessages(lambdaFunction);
    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"]
    }));

    new lambda.EventSourceMapping(this, "NotificationsQueueEventSource", {
      target: lambdaFunction,
      eventSourceArn: notificationsQueue.queueArn,
      batchSize: 10
    });

    new lambda.EventSourceMapping(this, "PaymentEventsQueueEventSource", {
      target: lambdaFunction,
      eventSourceArn: paymentEventsQueue.queueArn,
      batchSize: 10
    });

    new lambda.EventSourceMapping(this, "StorefrontOrdersQueueEventSource", {
      target: lambdaFunction,
      eventSourceArn: storefrontOrdersQueue.queueArn,
      batchSize: 10
    });

    const api = new apigateway.RestApi(this, "SupermarketApiGateway", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Authorization", "Content-Type"]
      }
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "SupermarketApiAuthorizer", {
      cognitoUserPools: [userPool]
    });

    api.root.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const healthResource = api.root.addResource("health");
    healthResource.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const apiResource = api.root.addResource("api");
    const productsResource = apiResource.addResource("products");
    productsResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const productsProxyResource = productsResource.addResource("{proxy+}");
    productsProxyResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const storefrontResource = apiResource.addResource("storefront");
    storefrontResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const storefrontProxyResource = storefrontResource.addResource("{proxy+}");
    storefrontProxyResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const notificationsResource = apiResource.addResource("notifications");
    notificationsResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const notificationsProxyResource = notificationsResource.addResource("{proxy+}");
    notificationsProxyResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const paymentsResource = apiResource.addResource("payments");
    const vnpayResource = paymentsResource.addResource("vnpay");
    vnpayResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const vnpayProxyResource = vnpayResource.addResource("{proxy+}");
    vnpayProxyResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const proxyResource = api.root.addResource("{proxy+}");
    proxyResource.addMethod("ANY", lambdaIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    new CfnOutput(this, "TableName", {
      value: table.tableName ?? dynamoTableName.valueAsString
    });

    new CfnOutput(this, "FunctionName", {
      value: lambdaFunction.functionName
    });

    new CfnOutput(this, "ApiGatewayUrl", {
      value: api.url
    });

    new CfnOutput(this, "ProductImagesBucketName", {
      value: productImagesBucket.bucketName
    });

    new CfnOutput(this, "NotificationsQueueUrl", {
      value: notificationsQueue.queueUrl
    });

    new CfnOutput(this, "AuditQueueUrl", {
      value: auditQueue.queueUrl
    });

    new CfnOutput(this, "StorefrontOrdersQueueUrl", {
      value: storefrontOrdersQueue.queueUrl
    });

    new CfnOutput(this, "StorefrontOrdersDlqUrl", {
      value: storefrontOrdersDlq.queueUrl
    });

    new CfnOutput(this, "PaymentEventsQueueUrl", {
      value: paymentEventsQueue.queueUrl
    });

    new CfnOutput(this, "PaymentEventsDlqUrl", {
      value: paymentEventsDlq.queueUrl
    });

    new CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId
    });

    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId
    });

    new CfnOutput(this, "CustomerGroupName", {
      value: customerGroup.groupName ?? "customer"
    });

    new CfnOutput(this, "AdminGroupName", {
      value: "admin"
    });

    new CfnOutput(this, "CognitoHostedUiDomain", {
      value: userPoolDomain.baseUrl()
    });
  }
}
