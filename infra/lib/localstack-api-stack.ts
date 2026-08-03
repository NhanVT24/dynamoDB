import * as path from "node:path";
import { Duration, CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export class LocalstackApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const localDynamoEndpoint = "http://localhost.localstack.cloud:4566";

    const table = new dynamodb.CfnTable(this, "MarketplaceProductsTable", {
      tableName: "MarketplaceProducts",
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

    const lambdaFunction = new lambda.Function(this, "SupermarketApiFunction", {
      functionName: "supermarket-api-localstack",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      handler: "src/lambda.handler",
      timeout: Duration.seconds(10),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda")),
      environment: {
        DYNAMODB_ENDPOINT: localDynamoEndpoint,
        DYNAMODB_TABLE_NAME: table.tableName ?? "MarketplaceProducts"
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
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${table.tableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${table.tableName}/index/*`
      ]
    }));

    const functionUrl = lambdaFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["http://localhost:3000"],
        allowedMethods: [
          lambda.HttpMethod.GET,
          lambda.HttpMethod.POST,
          lambda.HttpMethod.PATCH,
          lambda.HttpMethod.DELETE,
          lambda.HttpMethod.OPTIONS
        ],
        allowedHeaders: ["Content-Type"]
      }
    });

    lambdaFunction.addPermission("PublicInvokeFunctionUrl", {
      action: "lambda:InvokeFunctionUrl",
      principal: new iam.AnyPrincipal(),
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE
    });

    lambdaFunction.addPermission("PublicInvokeViaFunctionUrl", {
      action: "lambda:InvokeFunction",
      principal: new iam.AnyPrincipal(),
      invokedViaFunctionUrl: true
    });

    new CfnOutput(this, "TableName", {
      value: table.tableName ?? "MarketplaceProducts"
    });

    new CfnOutput(this, "FunctionName", {
      value: lambdaFunction.functionName
    });

    new CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url
    });
  }
}
