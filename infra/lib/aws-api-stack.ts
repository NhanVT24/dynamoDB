import * as path from "node:path";
import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
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

    const dynamoTableName = new CfnParameter(this, "DynamoTableName", {
      type: "String",
      default: "MarketplaceProductsDev",
      description: "DynamoDB table name for this stack"
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
      }
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "supermarket-web-client",
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [callbackUrl.valueAsString],
        logoutUrls: [logoutUrl.valueAsString]
      }
    });

    const userPoolDomain = userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix: cognitoDomainPrefix.valueAsString }
    });

    const lambdaFunction = new lambda.Function(this, "SupermarketApiFunction", {
      functionName: "supermarket-api-aws",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      handler: "src/lambda.handler",
      timeout: Duration.seconds(10),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda")),
      environment: {
        DYNAMODB_TABLE_NAME: table.tableName ?? dynamoTableName.valueAsString
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

    const api = new apigateway.RestApi(this, "SupermarketApiGateway", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Authorization", "Content-Type"]
      }
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);

    api.root.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    const healthResource = api.root.addResource("health");
    healthResource.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    api.root.addProxy({
      anyMethod: true,
      defaultIntegration: lambdaIntegration
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

    new CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId
    });

    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId
    });

    new CfnOutput(this, "CognitoHostedUiDomain", {
      value: userPoolDomain.baseUrl()
    });
  }
}
