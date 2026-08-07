import * as path from "node:path";
import { Duration, CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class LocalstackApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const localDynamoEndpoint = "http://localhost.localstack.cloud:4566";
    const localS3Endpoint = "http://s3.localhost.localstack.cloud:4566";

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

    const productImagesBucket = new s3.Bucket(this, "ProductImagesBucket", {
      bucketName: "supermarket-product-images-local",
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
      ]
    });

    const lambdaFunction = new lambda.Function(this, "SupermarketApiFunction", {
      functionName: "supermarket-api-localstack",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      handler: "src/lambda.handler",
      timeout: Duration.seconds(10),
      memorySize: 256,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../apps/api/dist/lambda")),
      environment: {
        DYNAMODB_ENDPOINT: localDynamoEndpoint,
        DYNAMODB_TABLE_NAME: table.tableName ?? "MarketplaceProducts",
        S3_BUCKET_NAME: productImagesBucket.bucketName,
        S3_ENDPOINT: localS3Endpoint,
        S3_PUBLIC_BASE_URL: `${localS3Endpoint}/${productImagesBucket.bucketName}`,
        S3_FORCE_PATH_STYLE: "true"
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

    productImagesBucket.grantReadWrite(lambdaFunction);

    const api = new apigateway.LambdaRestApi(this, "SupermarketApiGateway", {
      handler: lambdaFunction,
      proxy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type"]
      }
    });

    new CfnOutput(this, "TableName", {
      value: table.tableName ?? "MarketplaceProducts"
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
  }
}
