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
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as pipes from "aws-cdk-lib/aws-pipes";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

export class AwsApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const gsiDeploymentPhase = this.node.tryGetContext("dynamodbGsiDeploymentPhase");
    if (gsiDeploymentPhase && gsiDeploymentPhase !== "entity-only") {
      throw new Error("dynamodbGsiDeploymentPhase must be 'entity-only' when provided.");
    }
    // DynamoDB permits only one GSI create/delete operation per table update.
    // Use entity-only for the first deployment, then deploy normally to add the sale index.
    const includeSaleCampaignTimelineIndex = gsiDeploymentPhase !== "entity-only";

    // A single FIFO group intentionally serializes checkout reservations.
    // Do not increase this batch size unless the worker is changed accordingly.
    const checkoutGatePipeParameters = { batchSize: 1 };

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

    const adminReportEmail = new CfnParameter(this, "AdminReportEmail", {
      type: "String",
      default: "vonhan2432005@gmail.com",
      description: "Admin email address that receives the weekly revenue report"
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
        { attributeName: "entityType", attributeType: "S" },
        ...(includeSaleCampaignTimelineIndex ? [
          { attributeName: "campaignStatus", attributeType: "S" },
          { attributeName: "startAt", attributeType: "S" }
        ] : []),
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
        },
        {
          indexName: "EntityUpdatedAtIndex",
          keySchema: [
            { attributeName: "entityType", keyType: "HASH" },
            { attributeName: "updatedAt", keyType: "RANGE" }
          ],
          projection: { projectionType: "ALL" }
        },
        ...(includeSaleCampaignTimelineIndex ? [{
          indexName: "SaleCampaignTimelineIndex",
          keySchema: [
            { attributeName: "campaignStatus", keyType: "HASH" },
            { attributeName: "startAt", keyType: "RANGE" }
          ],
          projection: { projectionType: "ALL" }
        }] : [])
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

    const notificationsDlq = new sqs.Queue(this, "NotificationsDlq", {
      queueName: "supermarket-notifications-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const notificationsQueue = new sqs.Queue(this, "NotificationsQueue", {
      queueName: "supermarket-notifications",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: notificationsDlq,
        maxReceiveCount: 3
      }
    });

    const auditQueue = new sqs.Queue(this, "AuditQueue", {
      queueName: "supermarket-audit-log",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4)
    });

    const eventBridgeTargetDlq = new sqs.Queue(this, "EventBridgeTargetDlq", {
      queueName: "supermarket-eventbridge-target-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const storefrontOrdersDlq = new sqs.Queue(this, "StorefrontOrdersDlq", {
      queueName: "supermarket-storefront-orders-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const checkoutGateDlq = new sqs.Queue(this, "CheckoutGateDlq", {
      queueName: "supermarket-checkout-gate-dlq.fifo",
      fifo: true,
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const checkoutGateQueue = new sqs.Queue(this, "CheckoutGateQueue", {
      queueName: "supermarket-checkout-gate.fifo",
      fifo: true,
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: checkoutGateDlq,
        maxReceiveCount: 3
      }
    });

    // Kept only to drain messages created before checkout moved to the FIFO lane.
    // A Standard source requires a Standard DLQ, even though new checkouts no
    // longer use this queue.
    const checkoutGateInteractiveDlq = new sqs.Queue(this, "CheckoutGateInteractiveDlq", {
      queueName: "supermarket-checkout-gate-interactive-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const checkoutGateInteractiveQueue = new sqs.Queue(this, "CheckoutGateInteractiveQueue", {
      queueName: "supermarket-checkout-gate-interactive",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: checkoutGateInteractiveDlq,
        maxReceiveCount: 3
      }
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

    const imageUploadsDlq = new sqs.Queue(this, "ImageUploadsDlq", {
      queueName: "supermarket-image-uploads-dlq",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14)
    });

    const imageUploadsQueue = new sqs.Queue(this, "ImageUploadsQueue", {
      queueName: "supermarket-image-uploads",
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: imageUploadsDlq,
        maxReceiveCount: 3
      }
    });

    const commerceEventBus = new events.EventBus(this, "SupermarketCommerceEventBus", {
      eventBusName: "supermarket-commerce-bus"
    });
    const paymentEventBus = new events.EventBus(this, "SupermarketPaymentEventBus", {
      eventBusName: "supermarket-payment-bus"
    });
    const platformEventBus = new events.EventBus(this, "SupermarketPlatformEventBus", {
      eventBusName: "supermarket-platform-bus"
    });
    const saleSchedulerGroup = new scheduler.CfnScheduleGroup(this, "SaleSchedulerGroup", {
      name: "supermarket-sales"
    });
    const commerceArchive = new events.CfnArchive(this, "SupermarketCommerceArchive", {
      archiveName: "supermarket-commerce-archive",
      description: "Lưu lịch sử event commerce để replay khi cần.",
      sourceArn: commerceEventBus.eventBusArn,
      retentionDays: 30
    });
    const paymentArchive = new events.CfnArchive(this, "SupermarketPaymentArchive", {
      archiveName: "supermarket-payment-archive",
      description: "Lưu lịch sử event payment để replay khi cần.",
      sourceArn: paymentEventBus.eventBusArn,
      retentionDays: 30
    });
    const platformArchive = new events.CfnArchive(this, "SupermarketPlatformArchive", {
      archiveName: "supermarket-platform-archive",
      description: "Lưu lịch sử event platform để replay khi cần.",
      sourceArn: platformEventBus.eventBusArn,
      retentionDays: 30
    });

    const cognitoTriggerFunction = new lambda.Function(this, "CognitoTriggerFunction", {
      functionName: "supermarket-cognito-trigger",
      runtime: lambda.Runtime.NODEJS_24_X,
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

    const sharedLambdaCode = lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda.zip"));
    const adminAlertsTopic = new sns.Topic(this, "AdminAlertsTopic", {
      topicName: "supermarket-admin-alerts",
      displayName: "Supermarket Admin Alerts"
    });
    adminAlertsTopic.addSubscription(new subscriptions.EmailSubscription(adminReportEmail.valueAsString));
    const inventoryReportEventsTopic = new sns.Topic(this, "InventoryReportEventsTopic", {
      topicName: "supermarket-inventory-report-events",
      displayName: "Supermarket Inventory Report SES Events"
    });
    const inventoryReportConfigurationSet = new ses.CfnConfigurationSet(this, "InventoryReportConfigurationSet", {
      name: "supermarket-inventory-daily-report"
    });
    const inventoryReportSesEventDestination = new ses.CfnConfigurationSetEventDestination(this, "InventoryReportSesEventDestination", {
      configurationSetName: inventoryReportConfigurationSet.ref,
      eventDestination: {
        enabled: true,
        matchingEventTypes: ["SEND", "DELIVERY", "BOUNCE", "REJECT", "DELIVERY_DELAY"],
        snsDestination: {
          topicArn: inventoryReportEventsTopic.topicArn
        }
      }
    });
    const inventoryReportEventsTopicPolicy = new sns.TopicPolicy(this, "InventoryReportEventsTopicPolicy", {
      topics: [inventoryReportEventsTopic]
    });
    inventoryReportEventsTopicPolicy.document.addStatements(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
      actions: ["sns:Publish"],
      resources: [inventoryReportEventsTopic.topicArn],
      conditions: {
        StringEquals: {
          "AWS:SourceAccount": this.account
        },
        ArnLike: {
          "AWS:SourceArn": `arn:aws:ses:${this.region}:${this.account}:configuration-set/${inventoryReportConfigurationSet.ref}`
        }
      }
    }));
    // SES validates its SNS publish permission while creating the event destination.
    inventoryReportSesEventDestination.addResourceDependency(
      inventoryReportEventsTopicPolicy.node.defaultChild as sns.CfnTopicPolicy
    );

    const sharedEnvironment = {
      DYNAMODB_TABLE_NAME: table.tableName ?? dynamoTableName.valueAsString,
      S3_BUCKET_NAME: productImagesBucket.bucketName,
      S3_PUBLIC_BASE_URL: `https://${productImagesBucket.bucketName}.s3.${this.region}.amazonaws.com`,
      SQS_NOTIFICATIONS_QUEUE_URL: notificationsQueue.queueUrl,
      SQS_AUDIT_QUEUE_URL: auditQueue.queueUrl,
      SQS_PAYMENT_EVENTS_QUEUE_URL: paymentEventsQueue.queueUrl,
      SQS_STOREFRONT_ORDERS_QUEUE_URL: storefrontOrdersQueue.queueUrl,
      SQS_CHECKOUT_GATE_QUEUE_URL: checkoutGateQueue.queueUrl,
      SQS_CHECKOUT_GATE_INTERACTIVE_QUEUE_URL: checkoutGateInteractiveQueue.queueUrl,
      SQS_IMAGE_UPLOADS_QUEUE_URL: imageUploadsQueue.queueUrl,
      SQS_NOTIFICATIONS_DLQ_URL: notificationsDlq.queueUrl,
      SQS_STOREFRONT_ORDERS_DLQ_URL: storefrontOrdersDlq.queueUrl,
      SQS_PAYMENT_EVENTS_DLQ_URL: paymentEventsDlq.queueUrl,
      SQS_IMAGE_UPLOADS_DLQ_URL: imageUploadsDlq.queueUrl,
      SQS_EVENTBRIDGE_TARGET_DLQ_URL: eventBridgeTargetDlq.queueUrl,
      EVENTBRIDGE_BUS_NAME: platformEventBus.eventBusName,
      EVENTBRIDGE_DEFAULT_BUS_NAME: platformEventBus.eventBusName,
      EVENTBRIDGE_COMMERCE_BUS_NAME: commerceEventBus.eventBusName,
      EVENTBRIDGE_PAYMENT_BUS_NAME: paymentEventBus.eventBusName,
      EVENTBRIDGE_PLATFORM_BUS_NAME: platformEventBus.eventBusName,
      EVENTBRIDGE_COMMERCE_ARCHIVE_ARN: commerceArchive.attrArn,
      EVENTBRIDGE_PAYMENT_ARCHIVE_ARN: paymentArchive.attrArn,
      EVENTBRIDGE_PLATFORM_ARCHIVE_ARN: platformArchive.attrArn,
      CHECKOUT_TX_RACE_LOGGING: "false",
      SNS_ADMIN_ALERTS_TOPIC_ARN: adminAlertsTopic.topicArn,
      SES_FROM_EMAIL: sesFromEmail.valueAsString,
      SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME: inventoryReportConfigurationSet.ref,
      ADMIN_REPORT_EMAIL: adminReportEmail.valueAsString,
      VNPAY_TMN_CODE: vnpayTmnCodeValue,
      VNPAY_HASH_SECRET: vnpayHashSecret.valueAsString,
      VNPAY_PAYMENT_URL: vnpayPaymentUrlValue,
      VNPAY_RETURN_URL: vnpayReturnUrl.valueAsString,
      VNPAY_IPN_URL: vnpayIpnUrl.valueAsString
    };

    const attachSharedPolicies = (fn: lambda.Function) => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
          "dynamodb:TransactWriteItems"
        ],
        resources: [
          table.attrArn,
          `${table.attrArn}/index/*`
        ]
      }));

      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"]
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:DeleteMessageBatch",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
          "sqs:ChangeMessageVisibilityBatch"
        ],
        resources: [
          notificationsDlq.queueArn,
          storefrontOrdersDlq.queueArn,
          paymentEventsDlq.queueArn,
          imageUploadsDlq.queueArn,
          eventBridgeTargetDlq.queueArn
        ]
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [
          commerceEventBus.eventBusArn,
          paymentEventBus.eventBusArn,
          platformEventBus.eventBusArn
        ]
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["events:StartReplay", "events:DescribeReplay"],
        resources: [
          commerceArchive.attrArn,
          paymentArchive.attrArn,
          platformArchive.attrArn,
          `arn:aws:events:${this.region}:${this.account}:replay/*`
        ]
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["sns:Publish"],
        resources: [adminAlertsTopic.topicArn]
      }));

      productImagesBucket.grantReadWrite(fn);
      notificationsQueue.grantSendMessages(fn);
      auditQueue.grantSendMessages(fn);
      storefrontOrdersQueue.grantSendMessages(fn);
      checkoutGateQueue.grantSendMessages(fn);
      checkoutGateInteractiveQueue.grantSendMessages(fn);
      paymentEventsQueue.grantSendMessages(fn);
      imageUploadsQueue.grantSendMessages(fn);
    };

    const createApplicationLambda = (
      id: string,
      functionName: string,
      handler: string,
      timeoutSeconds = 10,
      memorySize = 256
    ) => {
      const fn = new lambda.Function(this, id, {
        functionName,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.X86_64,
        handler,
        timeout: Duration.seconds(timeoutSeconds),
        memorySize,
        code: sharedLambdaCode,
        environment: {
          ...sharedEnvironment,
          LAMBDA_FUNCTION_CONTEXT: functionName
        }
      });

      attachSharedPolicies(fn);
      return fn;
    };

    const httpApiFunction = createApplicationLambda(
      "SupermarketHttpApiFunction",
      "supermarket-http-api-aws",
      "src/lambda/handlers/admin.handler",
      25,
      256
    );
    const orderWorkerFunction = createApplicationLambda(
      "SupermarketOrderWorkerFunction",
      "supermarket-order-worker-aws",
      "src/lambda/handlers/order-worker.handler",
      20,
      512
    );
    const checkoutGateWorkerFunction = createApplicationLambda(
      "SupermarketCheckoutGateWorkerFunction",
      "supermarket-checkout-gate-worker-aws",
      "src/lambda/handlers/checkout-gate-worker.handler",
      20,
      512
    );
    const notificationWorkerFunction = createApplicationLambda(
      "SupermarketNotificationWorkerFunction",
      "supermarket-notification-worker-aws",
      "src/lambda/handlers/notification-worker.handler",
      20,
      512
    );
    const paymentWorkerFunction = createApplicationLambda(
      "SupermarketPaymentWorkerFunction",
      "supermarket-payment-worker-aws",
      "src/lambda/handlers/payment-worker.handler",
      20,
      512
    );
    const weeklyAdminReportFunction = createApplicationLambda(
      "SupermarketWeeklyAdminReportFunction",
      "supermarket-weekly-admin-report-aws",
      "src/lambda/handlers/weekly-admin-report.handler",
      30,
      512
    );
    const dailyInventoryReportFunction = createApplicationLambda(
      "SupermarketDailyInventoryReportFunction",
      "supermarket-daily-inventory-report-aws",
      "src/lambda/handlers/daily-inventory-report.handler",
      30,
      512
    );
    const sesInventoryEventFunction = createApplicationLambda(
      "SupermarketSesInventoryEventFunction",
      "supermarket-ses-inventory-event-aws",
      "src/lambda/handlers/ses-inventory-event.handler",
      20,
      256
    );
    inventoryReportEventsTopic.addSubscription(new subscriptions.LambdaSubscription(sesInventoryEventFunction));
    // The daily digest is deliberately best-effort; a failed run is summarized by the next day instead of retrying immediately.
    new lambda.EventInvokeConfig(this, "DailyInventoryReportInvokeConfig", {
      function: dailyInventoryReportFunction,
      maxEventAge: Duration.hours(1),
      retryAttempts: 0
    });
    const orderWorkflowStepFunction = createApplicationLambda(
      "SupermarketOrderWorkflowStepFunction",
      "supermarket-order-workflow-step-aws",
      "src/lambda/handlers/order-workflow-step.handler",
      30,
      512
    );
    const paymentWorkflowStepFunction = createApplicationLambda(
      "SupermarketPaymentWorkflowStepFunction",
      "supermarket-payment-workflow-step-aws",
      "src/lambda/handlers/payment-workflow-step.handler",
      30,
      512
    );
    const imageWorkflowStepFunction = createApplicationLambda(
      "SupermarketImageWorkflowStepFunction",
      "supermarket-image-workflow-step-aws",
      "src/lambda/handlers/image-workflow-step.handler",
      20,
      256
    );
    const buildWeeklyReportFunction = createApplicationLambda(
      "SupermarketBuildWeeklyReportFunction",
      "supermarket-build-weekly-report-aws",
      "src/lambda/handlers/build-weekly-report.handler",
      30,
      512
    );
    const sendMailWorkflowStepFunction = createApplicationLambda(
      "SupermarketSendMailWorkflowStepFunction",
      "supermarket-send-mail-workflow-step-aws",
      "src/lambda/handlers/send-mail-workflow-step.handler",
      20,
      256
    );
    const imageUploadWorkerFunction = createApplicationLambda(
      "SupermarketImageUploadWorkerFunction",
      "supermarket-image-upload-worker-aws",
      "src/lambda/handlers/image-upload-worker.handler",
      20,
      256
    );
    const auditEventWorkerFunction = createApplicationLambda(
      "SupermarketAuditEventWorkerFunction",
      "supermarket-audit-event-worker-aws",
      "src/lambda/handlers/audit-event-worker.handler",
      15,
      256
    );
    const releaseExpiredCheckoutsFunction = createApplicationLambda(
      "SupermarketReleaseExpiredCheckoutsFunction",
      "supermarket-release-expired-checkouts-aws",
      "src/lambda/handlers/release-expired-checkouts.handler",
      20,
      256
    );
    const dataCleanupFunction = createApplicationLambda(
      "SupermarketDataCleanupFunction",
      "supermarket-data-cleanup-aws",
      "src/lambda/handlers/data-cleanup.handler",
      120,
      512
    );
    const saleCampaignWorkerFunction = createApplicationLambda(
      "SupermarketSaleCampaignWorkerFunction",
      "supermarket-sale-campaign-worker-aws",
      "src/lambda/handlers/sale-campaign-worker.handler",
      20,
      256
    );
    const saleSchedulerRole = new iam.Role(this, "SaleSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to activate and end sale campaigns"
    });
    saleSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [saleCampaignWorkerFunction.functionArn]
    }));
    httpApiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["scheduler:CreateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule", "scheduler:UpdateSchedule"],
      resources: [
        saleSchedulerGroup.attrArn,
        `arn:aws:scheduler:${this.region}:${this.account}:schedule/${saleSchedulerGroup.name}/*`
      ]
    }));
    httpApiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [saleSchedulerRole.roleArn]
    }));
    httpApiFunction.addEnvironment("SALE_SCHEDULER_ROLE_ARN", saleSchedulerRole.roleArn);
    httpApiFunction.addEnvironment("SALE_SCHEDULER_GROUP_NAME", saleSchedulerGroup.ref);
    httpApiFunction.addEnvironment("SALE_SCHEDULER_TARGET_ARN", saleCampaignWorkerFunction.functionArn);
    new lambda.EventInvokeConfig(this, "DataCleanupInvokeConfig", {
      function: dataCleanupFunction,
      maxEventAge: Duration.hours(1),
      retryAttempts: 0
    });

    const orderWorkflowTask = new tasks.LambdaInvoke(this, "OrderWorkflowTask", {
      lambdaFunction: orderWorkflowStepFunction,
      payload: sfn.TaskInput.fromObject({
        detail: sfn.JsonPath.objectAt("$.detail")
      }),
      resultPath: "$.orderResult",
      payloadResponseOnly: true
    });

    const paymentWorkflowTask = new tasks.LambdaInvoke(this, "PaymentWorkflowTask", {
      lambdaFunction: paymentWorkflowStepFunction,
      payload: sfn.TaskInput.fromObject({
        detail: sfn.JsonPath.objectAt("$.detail"),
        orderResult: sfn.JsonPath.objectAt("$.orderResult")
      }),
      resultPath: "$.paymentResult",
      payloadResponseOnly: true
    });

    const imageWorkflowTask = new tasks.LambdaInvoke(this, "ImageWorkflowTask", {
      lambdaFunction: imageWorkflowStepFunction,
      payloadResponseOnly: true
    });

    const buildWeeklyReportTask = new tasks.LambdaInvoke(this, "BuildWeeklyReportTask", {
      lambdaFunction: buildWeeklyReportFunction,
      payloadResponseOnly: true
    });

    const sendWeeklyMailTask = new tasks.LambdaInvoke(this, "SendWeeklyMailTask", {
      lambdaFunction: sendMailWorkflowStepFunction,
      payload: sfn.TaskInput.fromObject({
        mailType: sfn.JsonPath.stringAt("$.mailType"),
        summary: sfn.JsonPath.objectAt("$.summary")
      }),
      payloadResponseOnly: true
    });

    const orderOutcomeChoice = new sfn.Choice(this, "OrderWorkflowOutcome");
    const orderPaymentWorkflow = new sfn.StateMachine(this, "OrderPaymentWorkflow", {
      stateMachineName: "supermarket-order-payment-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(
        orderWorkflowTask
          .addRetry({ maxAttempts: 2, interval: Duration.seconds(2) })
          .addCatch(new sfn.Fail(this, "OrderWorkflowFailed"), { resultPath: "$.error" })
          .next(orderOutcomeChoice
            .when(sfn.Condition.stringEquals("$.orderResult.outcome", "success"), paymentWorkflowTask)
            .otherwise(new sfn.Succeed(this, "OrderWorkflowCompletedWithoutPayment")))
      ),
      timeout: Duration.minutes(5)
    });

    const imageUploadWorkflow = new sfn.StateMachine(this, "ImageUploadWorkflow", {
      stateMachineName: "supermarket-image-upload-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(
        imageWorkflowTask
          .addRetry({ maxAttempts: 2, interval: Duration.seconds(2) })
          .next(new sfn.Succeed(this, "ImageWorkflowCompleted"))
      ),
      timeout: Duration.minutes(2)
    });

    const weeklyReportMailWorkflow = new sfn.StateMachine(this, "WeeklyReportMailWorkflow", {
      stateMachineName: "supermarket-weekly-report-mail-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(
        buildWeeklyReportTask
          .addRetry({ maxAttempts: 2, interval: Duration.seconds(2) })
          .next(sendWeeklyMailTask)
          .next(new sfn.Succeed(this, "WeeklyReportMailWorkflowCompleted"))
      ),
      timeout: Duration.minutes(5)
    });

    const createPipeRole = (id: string, sourceQueue: sqs.Queue, targetArn: string, extraStatements: iam.PolicyStatement[] = []) => {
      const role = new iam.Role(this, id, {
        assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com")
      });

      role.addToPolicy(new iam.PolicyStatement({
        actions: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ],
        resources: [sourceQueue.queueArn]
      }));

      role.addToPolicy(new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [targetArn]
      }));

      for (const statement of extraStatements) {
        role.addToPolicy(statement);
      }

      return role;
    };

    const orderWorkerPipeRole = createPipeRole(
      "StorefrontOrdersPipeRole",
      storefrontOrdersQueue,
      orderWorkerFunction.functionArn
    );
    const checkoutGatePipeRole = createPipeRole(
      "CheckoutGatePipeRole",
      checkoutGateQueue,
      checkoutGateWorkerFunction.functionArn
    );
    const checkoutGateInteractivePipeRole = createPipeRole(
      "CheckoutGateInteractivePipeRole",
      checkoutGateInteractiveQueue,
      checkoutGateWorkerFunction.functionArn
    );
    const notificationPipeRole = createPipeRole(
      "NotificationsPipeRole",
      notificationsQueue,
      notificationWorkerFunction.functionArn
    );
    const paymentPipeRole = createPipeRole(
      "PaymentEventsPipeRole",
      paymentEventsQueue,
      paymentWorkerFunction.functionArn
    );
    const imageUploadsPipeRole = new iam.Role(this, "ImageUploadsPipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com")
    });
    imageUploadsPipeRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      resources: [imageUploadsQueue.queueArn]
    }));
    imageUploadsPipeRole.addToPolicy(new iam.PolicyStatement({
      actions: ["states:StartExecution"],
      resources: [imageUploadWorkflow.stateMachineArn]
    }));
    new pipes.CfnPipe(this, "StorefrontOrdersPipe", {
      name: "supermarket-storefront-orders-pipe",
      roleArn: orderWorkerPipeRole.roleArn,
      source: storefrontOrdersQueue.queueArn,
      target: orderWorkerFunction.functionArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 10
        }
      },
      targetParameters: {
        lambdaFunctionParameters: {
          invocationType: "REQUEST_RESPONSE"
        }
      }
    });

    new pipes.CfnPipe(this, "CheckoutGatePipe", {
      // FIFO changes the Pipe source type, which requires a replacement.
      // A new physical name lets CloudFormation create it before deleting
      // the Standard-SQS Pipe from the previous checkout implementation.
      name: "supermarket-checkout-gate-fifo-pipe",
      roleArn: checkoutGatePipeRole.roleArn,
      source: checkoutGateQueue.queueArn,
      target: checkoutGateWorkerFunction.functionArn,
      sourceParameters: {
        sqsQueueParameters: checkoutGatePipeParameters
      },
      targetParameters: {
        lambdaFunctionParameters: {
          invocationType: "REQUEST_RESPONSE"
        }
      }
    });

    new pipes.CfnPipe(this, "CheckoutGateInteractivePipe", {
      name: "supermarket-checkout-gate-interactive-pipe",
      roleArn: checkoutGateInteractivePipeRole.roleArn,
      source: checkoutGateInteractiveQueue.queueArn,
      target: checkoutGateWorkerFunction.functionArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 10
        }
      },
      targetParameters: {
        lambdaFunctionParameters: {
          invocationType: "REQUEST_RESPONSE"
        }
      }
    });

    new pipes.CfnPipe(this, "NotificationsPipe", {
      name: "supermarket-notifications-pipe",
      roleArn: notificationPipeRole.roleArn,
      source: notificationsQueue.queueArn,
      target: notificationWorkerFunction.functionArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 10
        }
      },
      targetParameters: {
        lambdaFunctionParameters: {
          invocationType: "REQUEST_RESPONSE"
        }
      }
    });

    new pipes.CfnPipe(this, "PaymentEventsPipe", {
      name: "supermarket-payment-events-pipe",
      roleArn: paymentPipeRole.roleArn,
      source: paymentEventsQueue.queueArn,
      target: paymentWorkerFunction.functionArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 10
        }
      },
      targetParameters: {
        lambdaFunctionParameters: {
          invocationType: "REQUEST_RESPONSE"
        }
      }
    });

    new pipes.CfnPipe(this, "ImageUploadsPipe", {
      name: "supermarket-image-uploads-pipe",
      roleArn: imageUploadsPipeRole.roleArn,
      source: imageUploadsQueue.queueArn,
      target: imageUploadWorkflow.stateMachineArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 10
        }
      },
      targetParameters: {
        stepFunctionStateMachineParameters: {
          invocationType: "FIRE_AND_FORGET"
        }
      }
    });

    productImagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.SqsDestination(imageUploadsQueue)
    );

    new events.Rule(this, "CommerceOrderRequestedRule", {
      eventBus: commerceEventBus,
      ruleName: "supermarket-commerce-order-requested-rule",
      eventPattern: {
        source: ["supermarket.commerce"],
        detailType: ["storefront.order.requested"]
      },
      targets: [new eventsTargets.SfnStateMachine(orderPaymentWorkflow, {
        deadLetterQueue: eventBridgeTargetDlq,
        retryAttempts: 2
      })]
    });

    new events.Rule(this, "CommerceCheckoutGateRule", {
      eventBus: commerceEventBus,
      ruleName: "supermarket-commerce-checkout-gate-rule",
      eventPattern: {
        source: ["supermarket.commerce"],
        detailType: ["storefront.checkout.gate.requested"]
      },
      targets: [new eventsTargets.SqsQueue(checkoutGateQueue, {
        deadLetterQueue: eventBridgeTargetDlq,
        messageGroupId: "checkout-gate-serial"
      })]
    });

    new events.Rule(this, "CommerceLifecycleAuditRule", {
      eventBus: commerceEventBus,
      ruleName: "supermarket-commerce-lifecycle-audit-rule",
      eventPattern: {
        source: ["supermarket.commerce"]
      },
      targets: [new eventsTargets.LambdaFunction(auditEventWorkerFunction, {
        deadLetterQueue: eventBridgeTargetDlq,
        retryAttempts: 2
      })]
    });

    new events.Rule(this, "PaymentLifecycleQueueRule", {
      eventBus: paymentEventBus,
      ruleName: "supermarket-payment-lifecycle-queue-rule",
      eventPattern: {
        source: ["supermarket.payment"],
        detailType: ["payments.vnpay.completed", "payments.vnpay.failed"]
      },
      targets: [new eventsTargets.SqsQueue(paymentEventsQueue, {
        deadLetterQueue: eventBridgeTargetDlq
      })]
    });

    new events.Rule(this, "PaymentLifecycleAuditRule", {
      eventBus: paymentEventBus,
      ruleName: "supermarket-payment-lifecycle-audit-rule",
      eventPattern: {
        source: ["supermarket.payment"]
      },
      targets: [new eventsTargets.LambdaFunction(auditEventWorkerFunction, {
        deadLetterQueue: eventBridgeTargetDlq,
        retryAttempts: 2
      })]
    });

    new events.Rule(this, "PlatformNotificationsRule", {
      eventBus: platformEventBus,
      ruleName: "supermarket-platform-notifications-rule",
      eventPattern: {
        source: ["supermarket.platform"],
        detailType: ["notifications.pending"]
      },
      targets: [new eventsTargets.SqsQueue(notificationsQueue, {
        deadLetterQueue: eventBridgeTargetDlq
      })]
    });

    new events.Rule(this, "InventoryAdminAlertsRule", {
      eventBus: platformEventBus,
      ruleName: "supermarket-inventory-admin-alerts-rule",
      eventPattern: {
        source: ["supermarket.inventory"],
        detailType: ["inventory.stock.alert"],
        detail: {
          alertLevel: ["low_stock", "out_of_stock"]
        }
      },
      targets: [new eventsTargets.SqsQueue(notificationsQueue, {
        deadLetterQueue: eventBridgeTargetDlq
      })]
    });

    new events.Rule(this, "PlatformAuditRule", {
      eventBus: platformEventBus,
      ruleName: "supermarket-platform-audit-rule",
      eventPattern: {
        source: ["supermarket.platform"],
        detailType: ["audit.log.created"]
      },
      targets: [new eventsTargets.LambdaFunction(auditEventWorkerFunction, {
        deadLetterQueue: eventBridgeTargetDlq,
        retryAttempts: 2
      })]
    });

    const weeklyAdminRevenueReportSchedulerRole = new iam.Role(this, "WeeklyAdminRevenueReportSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to start the weekly admin revenue report workflow"
    });
    weeklyAdminRevenueReportSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["states:StartExecution"],
      resources: [weeklyReportMailWorkflow.stateMachineArn]
    }));
    weeklyAdminRevenueReportSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [eventBridgeTargetDlq.queueArn]
    }));

    new scheduler.CfnSchedule(this, "WeeklyAdminRevenueReportSchedule", {
      name: "supermarket-weekly-admin-revenue-report",
      description: "Triggers the weekly admin revenue report workflow every Monday at 02:45 UTC.",
      groupName: "default",
      scheduleExpression: "cron(45 2 ? * MON *)",
      flexibleTimeWindow: {
        mode: "OFF"
      },
      target: {
        arn: weeklyReportMailWorkflow.stateMachineArn,
        roleArn: weeklyAdminRevenueReportSchedulerRole.roleArn,
        deadLetterConfig: {
          arn: eventBridgeTargetDlq.queueArn
        },
        retryPolicy: {
          maximumEventAgeInSeconds: 3600,
          maximumRetryAttempts: 2
        },
        input: JSON.stringify({
          source: "scheduler.weekly-admin-revenue-report"
        })
      }
    });

    const dailyInventoryReportSchedulerRole = new iam.Role(this, "DailyInventoryReportSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke the daily inventory digest Lambda"
    });
    dailyInventoryReportSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [dailyInventoryReportFunction.functionArn]
    }));
    dailyInventoryReportSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [eventBridgeTargetDlq.queueArn]
    }));

    new scheduler.CfnSchedule(this, "DailyInventoryReportSchedule", {
      name: "supermarket-daily-inventory-report",
      description: "Invokes the inventory alert check at 22:00 in Vietnam; the worker sends on alternating calendar days.",
      groupName: "default",
      scheduleExpression: "cron(0 22 * * ? *)",
      scheduleExpressionTimezone: "Asia/Ho_Chi_Minh",
      flexibleTimeWindow: {
        mode: "OFF"
      },
      target: {
        arn: dailyInventoryReportFunction.functionArn,
        roleArn: dailyInventoryReportSchedulerRole.roleArn,
        deadLetterConfig: {
          arn: eventBridgeTargetDlq.queueArn
        },
        retryPolicy: {
          maximumEventAgeInSeconds: 60,
          maximumRetryAttempts: 0
        },
        input: JSON.stringify({
          source: "scheduler.daily-inventory-report"
        })
      }
    });

    const releaseExpiredCheckoutsSchedulerRole = new iam.Role(this, "ReleaseExpiredCheckoutsSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke the expired checkout hold cleanup Lambda"
    });
    releaseExpiredCheckoutsSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [releaseExpiredCheckoutsFunction.functionArn]
    }));
    releaseExpiredCheckoutsSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [eventBridgeTargetDlq.queueArn]
    }));

    new scheduler.CfnSchedule(this, "ReleaseExpiredCheckoutsSchedule", {
      name: "supermarket-release-expired-checkouts",
      description: "Releases checkout holds that have passed the 5-minute lock window.",
      groupName: "default",
      scheduleExpression: "rate(1 minute)",
      flexibleTimeWindow: {
        mode: "OFF"
      },
      target: {
        arn: releaseExpiredCheckoutsFunction.functionArn,
        roleArn: releaseExpiredCheckoutsSchedulerRole.roleArn,
        deadLetterConfig: {
          arn: eventBridgeTargetDlq.queueArn
        },
        retryPolicy: {
          maximumEventAgeInSeconds: 300,
          maximumRetryAttempts: 2
        },
        input: JSON.stringify({
          source: "scheduler.release-expired-checkouts"
        })
      }
    });

    const dataCleanupSchedulerRole = new iam.Role(this, "DataCleanupSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke the scheduled data cleanup Lambda"
    });
    dataCleanupSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [dataCleanupFunction.functionArn]
    }));
    dataCleanupSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [eventBridgeTargetDlq.queueArn]
    }));

    new scheduler.CfnSchedule(this, "DataCleanupSchedule", {
      name: "supermarket-data-cleanup",
      description: "Checks cleanup eligibility at midnight Vietnam time and deletes short-lived operational data after three days.",
      groupName: "default",
      scheduleExpression: "cron(0 0 * * ? *)",
      scheduleExpressionTimezone: "Asia/Ho_Chi_Minh",
      flexibleTimeWindow: {
        mode: "OFF"
      },
      target: {
        arn: dataCleanupFunction.functionArn,
        roleArn: dataCleanupSchedulerRole.roleArn,
        deadLetterConfig: {
          arn: eventBridgeTargetDlq.queueArn
        },
        retryPolicy: {
          maximumEventAgeInSeconds: 60,
          maximumRetryAttempts: 0
        },
        input: JSON.stringify({
          source: "scheduler.data-cleanup"
        })
      }
    });

    // AWS Budgets data is delayed, so $70 is a deliberately early protective threshold.
    // The CostGuard function itself and the Cognito trigger are deliberately excluded from
    // the $100 Lambda throttle list: the former is needed for audit/recovery and the latter
    // avoids permanently breaking account sign-in.
    const costGuardStateParameterName = "/supermarket/cost-guard/state";
    const allApplicationLambdaNames = [
      httpApiFunction.functionName,
      orderWorkerFunction.functionName,
      checkoutGateWorkerFunction.functionName,
      notificationWorkerFunction.functionName,
      paymentWorkerFunction.functionName,
      weeklyAdminReportFunction.functionName,
      dailyInventoryReportFunction.functionName,
      sesInventoryEventFunction.functionName,
      orderWorkflowStepFunction.functionName,
      paymentWorkflowStepFunction.functionName,
      imageWorkflowStepFunction.functionName,
      buildWeeklyReportFunction.functionName,
      sendMailWorkflowStepFunction.functionName,
      imageUploadWorkerFunction.functionName,
      auditEventWorkerFunction.functionName,
      releaseExpiredCheckoutsFunction.functionName,
      dataCleanupFunction.functionName,
      saleCampaignWorkerFunction.functionName
    ];
    const allPipes = [
      "supermarket-storefront-orders-pipe",
      "supermarket-checkout-gate-fifo-pipe",
      "supermarket-checkout-gate-interactive-pipe",
      "supermarket-notifications-pipe",
      "supermarket-payment-events-pipe",
      "supermarket-image-uploads-pipe"
    ];
    const allRules = [
      { name: "supermarket-commerce-order-requested-rule", eventBusName: commerceEventBus.eventBusName },
      { name: "supermarket-commerce-checkout-gate-rule", eventBusName: commerceEventBus.eventBusName },
      { name: "supermarket-commerce-lifecycle-audit-rule", eventBusName: commerceEventBus.eventBusName },
      { name: "supermarket-payment-lifecycle-queue-rule", eventBusName: paymentEventBus.eventBusName },
      { name: "supermarket-payment-lifecycle-audit-rule", eventBusName: paymentEventBus.eventBusName },
      { name: "supermarket-platform-notifications-rule", eventBusName: platformEventBus.eventBusName },
      { name: "supermarket-inventory-admin-alerts-rule", eventBusName: platformEventBus.eventBusName },
      { name: "supermarket-platform-audit-rule", eventBusName: platformEventBus.eventBusName }
    ];
    const staticSchedules = [
      { name: "supermarket-weekly-admin-revenue-report", groupName: "default" },
      { name: "supermarket-daily-inventory-report", groupName: "default" },
      { name: "supermarket-release-expired-checkouts", groupName: "default" },
      { name: "supermarket-data-cleanup", groupName: "default" }
    ];
    const partialSchedules = staticSchedules.filter((schedule) => [
      "supermarket-weekly-admin-revenue-report",
      "supermarket-daily-inventory-report",
      "supermarket-data-cleanup"
    ].includes(schedule.name));
    const partialLambdas = [
      weeklyAdminReportFunction.functionName,
      dailyInventoryReportFunction.functionName,
      imageWorkflowStepFunction.functionName,
      buildWeeklyReportFunction.functionName,
      sendMailWorkflowStepFunction.functionName,
      imageUploadWorkerFunction.functionName,
      auditEventWorkerFunction.functionName,
      dataCleanupFunction.functionName,
      saleCampaignWorkerFunction.functionName
    ];
    const partialRules = allRules.filter((rule) => rule.name.endsWith("-audit-rule"));

    const costGuardBudgetTopic = new sns.Topic(this, "CostGuardBudgetTopic", {
      topicName: "supermarket-cost-guard-budget-events",
      displayName: "Supermarket CostGuard budget events"
    });
    costGuardBudgetTopic.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("budgets.amazonaws.com")],
      actions: ["sns:Publish"],
      resources: [costGuardBudgetTopic.topicArn],
      conditions: { StringEquals: { "AWS:SourceAccount": this.account } }
    }));

    const costGuardFunction = new lambda.Function(this, "CostGuardFunction", {
      functionName: "supermarket-cost-guard",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: "cost_guard.handler",
      timeout: Duration.minutes(5),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../lambda")),
      environment: {
        ALERT_EMAIL: adminReportEmail.valueAsString,
        SES_FROM_EMAIL: sesFromEmail.valueAsString,
        STATE_PARAMETER_NAME: costGuardStateParameterName,
        SALE_SCHEDULE_GROUP: saleSchedulerGroup.ref,
        ALL_APPLICATION_LAMBDAS: JSON.stringify(allApplicationLambdaNames),
        PARTIAL_LAMBDAS: JSON.stringify(partialLambdas),
        ALL_PIPES: JSON.stringify(allPipes),
        PARTIAL_PIPES: JSON.stringify([
          "supermarket-notifications-pipe",
          "supermarket-image-uploads-pipe"
        ]),
        ALL_RULES: JSON.stringify(allRules),
        PARTIAL_RULES: JSON.stringify(partialRules),
        STATIC_SCHEDULES: JSON.stringify(staticSchedules),
        PARTIAL_SCHEDULES: JSON.stringify(partialSchedules),
        STATE_MACHINES: JSON.stringify([
          orderPaymentWorkflow.stateMachineArn,
          imageUploadWorkflow.stateMachineArn,
          weeklyReportMailWorkflow.stateMachineArn
        ])
      }
    });
    costGuardFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "lambda:PutFunctionConcurrency",
        "events:DisableRule",
        "pipes:UpdatePipe",
        "scheduler:GetSchedule",
        "scheduler:ListSchedules",
        "scheduler:UpdateSchedule",
        "states:ListExecutions",
        "states:StopExecution",
        "ssm:PutParameter",
        "ses:SendEmail"
      ],
      resources: ["*"]
    }));
    costGuardBudgetTopic.addSubscription(new subscriptions.LambdaSubscription(costGuardFunction));

    new budgets.CfnBudget(this, "MonthlyCostGuardBudget", {
      budget: {
        budgetName: "supermarket-monthly-cost-guard-usd",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 100, unit: "USD" },
        costTypes: {
          includeCredit: true,
          includeDiscount: true,
          includeOtherSubscription: true,
          includeRecurring: true,
          includeRefund: false,
          includeSubscription: true,
          includeSupport: true,
          includeTax: true,
          includeUpfront: true,
          useAmortized: false,
          useBlended: false
        }
      },
      notificationsWithSubscribers: [5, 10, 15, 20, 50, 70, 100].map((threshold) => ({
        notification: {
          comparisonOperator: "GREATER_THAN",
          notificationType: "ACTUAL",
          threshold,
          thresholdType: "ABSOLUTE_VALUE"
        },
        subscribers: [{
          address: costGuardBudgetTopic.topicArn,
          subscriptionType: "SNS"
        }]
      }))
    });

    const createDlqAlarm = (id: string, queue: sqs.Queue, queueName: string) => {
      new cloudwatch.Alarm(this, id, {
        alarmName: `${queueName}-messages-visible`,
        metric: queue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
          statistic: "Maximum"
        }),
        threshold: 1,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `DLQ ${queueName} có message cần kiểm tra`
      });
    };

    createDlqAlarm("NotificationsDlqAlarm", notificationsDlq, "supermarket-notifications-dlq");
    createDlqAlarm("CheckoutGateDlqAlarm", checkoutGateDlq, "supermarket-checkout-gate-dlq");
    createDlqAlarm("CheckoutGateInteractiveDlqAlarm", checkoutGateInteractiveDlq, "supermarket-checkout-gate-interactive-dlq");
    createDlqAlarm("StorefrontOrdersDlqAlarm", storefrontOrdersDlq, "supermarket-storefront-orders-dlq");
    createDlqAlarm("PaymentEventsDlqAlarm", paymentEventsDlq, "supermarket-payment-events-dlq");
    createDlqAlarm("ImageUploadsDlqAlarm", imageUploadsDlq, "supermarket-image-uploads-dlq");
    createDlqAlarm("EventBridgeTargetDlqAlarm", eventBridgeTargetDlq, "supermarket-eventbridge-target-dlq");

    const api = new apigateway.RestApi(this, "SupermarketApiGateway", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Authorization", "Content-Type"]
      }
    });

    const httpIntegration = new apigateway.LambdaIntegration(httpApiFunction);
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "SupermarketApiAuthorizer", {
      cognitoUserPools: [userPool]
    });

    api.root.addMethod("GET", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const healthResource = api.root.addResource("health");
    healthResource.addMethod("GET", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const apiResource = api.root.addResource("api");
    const productsResource = apiResource.addResource("products");
    productsResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const productsProxyResource = productsResource.addResource("{proxy+}");
    productsProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const storefrontResource = apiResource.addResource("storefront");
    const storefrontProductsResource = storefrontResource.addResource("products");
    storefrontProductsResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const storefrontProductsProxyResource = storefrontProductsResource.addResource("{proxy+}");
    storefrontProductsProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const storefrontOrdersResource = storefrontResource.addResource("orders");
    storefrontOrdersResource.addMethod("POST", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const storefrontOrdersMeResource = storefrontOrdersResource.addResource("me");
    storefrontOrdersMeResource.addMethod("GET", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const storefrontProxyResource = storefrontResource.addResource("{proxy+}");
    storefrontProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const notificationsResource = apiResource.addResource("notifications");
    notificationsResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const notificationsProxyResource = notificationsResource.addResource("{proxy+}");
    notificationsProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const uploadsResource = apiResource.addResource("uploads");
    uploadsResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const uploadsProxyResource = uploadsResource.addResource("{proxy+}");
    uploadsProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const paymentsResource = apiResource.addResource("payments");
    const vnpayResource = paymentsResource.addResource("vnpay");
    vnpayResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });
    const vnpayProxyResource = vnpayResource.addResource("{proxy+}");
    vnpayProxyResource.addMethod("ANY", httpIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const proxyResource = api.root.addResource("{proxy+}");
    proxyResource.addMethod("ANY", httpIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    new CfnOutput(this, "TableName", {
      value: table.tableName ?? dynamoTableName.valueAsString
    });

    new CfnOutput(this, "FunctionName", {
      value: httpApiFunction.functionName
    });

    new CfnOutput(this, "PublicApiFunctionName", {
      value: httpApiFunction.functionName
    });

    new CfnOutput(this, "OrderApiFunctionName", {
      value: httpApiFunction.functionName
    });

    new CfnOutput(this, "PaymentApiFunctionName", {
      value: httpApiFunction.functionName
    });

    new CfnOutput(this, "OrderWorkerFunctionName", {
      value: orderWorkerFunction.functionName
    });

    new CfnOutput(this, "CheckoutGateWorkerFunctionName", {
      value: checkoutGateWorkerFunction.functionName
    });

    new CfnOutput(this, "NotificationWorkerFunctionName", {
      value: notificationWorkerFunction.functionName
    });

    new CfnOutput(this, "PaymentWorkerFunctionName", {
      value: paymentWorkerFunction.functionName
    });

    new CfnOutput(this, "AuditEventWorkerFunctionName", {
      value: auditEventWorkerFunction.functionName
    });

    new CfnOutput(this, "ReleaseExpiredCheckoutsFunctionName", {
      value: releaseExpiredCheckoutsFunction.functionName
    });

    new CfnOutput(this, "CommerceEventBusName", {
      value: commerceEventBus.eventBusName
    });

    new CfnOutput(this, "PaymentEventBusName", {
      value: paymentEventBus.eventBusName
    });

    new CfnOutput(this, "PlatformEventBusName", {
      value: platformEventBus.eventBusName
    });

    new CfnOutput(this, "CommerceArchiveArn", {
      value: commerceArchive.attrArn
    });

    new CfnOutput(this, "PaymentArchiveArn", {
      value: paymentArchive.attrArn
    });

    new CfnOutput(this, "PlatformArchiveArn", {
      value: platformArchive.attrArn
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

    new CfnOutput(this, "CheckoutGateQueueUrl", {
      value: checkoutGateQueue.queueUrl
    });

    new CfnOutput(this, "CheckoutGateInteractiveQueueUrl", {
      value: checkoutGateInteractiveQueue.queueUrl
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

    new CfnOutput(this, "AdminAlertsTopicArn", {
      value: adminAlertsTopic.topicArn
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
