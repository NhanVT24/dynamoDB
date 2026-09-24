import { RemovalPolicy, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

// Create the bucket under the existing stack to preserve its logical ID.
export function createProductImagesBucket(scope: Stack) {
  // Uploads still land in S3. The custom domain changes the public read URL,
  // not the storage location or the presigned PUT upload flow.
  const productImagesBucket = new s3.Bucket(scope, "ProductImagesBucket", {
    blockPublicAccess: new s3.BlockPublicAccess({
      blockPublicAcls: true,
      ignorePublicAcls: true,
      blockPublicPolicy: false,
      restrictPublicBuckets: false
    }),
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
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

  productImagesBucket.addToResourcePolicy(new iam.PolicyStatement({
    sid: "AllowPublicReadOnlyForPublicPrefix",
    effect: iam.Effect.ALLOW,
    principals: [new iam.AnyPrincipal()],
    actions: ["s3:GetObject"],
    resources: [productImagesBucket.arnForObjects("public/*")]
  }));

  return productImagesBucket;
}
