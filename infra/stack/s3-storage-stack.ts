import {
  CfnOutput,
  RemovalPolicy,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

const PUBLIC_PREFIX = "public";
const PRIVATE_PREFIX = "private";

export class S3StorageStack extends Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, "AppStorageBucket", {
      // Không set bucketName để CDK/AWS tự sinh tên unique toàn cầu.
      // Nếu cần tên cố định, có thể truyền bucketName, nhưng tên S3 phải unique trên toàn AWS.
      encryption: s3.BucketEncryption.S3_MANAGED,

      // Bắt buộc sử dụng HTTPS. Request HTTP sẽ bị deny bằng bucket policy do CDK tự sinh.
      enforceSSL: true,

      // Tắt cơ chế access control list để tránh nhầm lẫn và chuyển sang dùng bucket policy.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,

      // Ta không dùng ACL public-read. Public access chỉ được mở bằng bucket policy bên dưới.
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false
      }),

      // Cho browser upload/download bằng presigned URL. Backend vẫn là nơi quyết định key public/private.
      cors: [
        {
          allowedOrigins: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.PUT
          ],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000
        }
      ],

      // Production nên RETAIN để tránh xóa stack làm mất data.
      // Nếu chỉ test/dev, có thể đổi thành DESTROY và autoDeleteObjects: true.
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false
    });

    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowPublicReadOnlyForPublicPrefix",
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject"],
        resources: [this.bucket.arnForObjects(`${PUBLIC_PREFIX}/*`)]
      })
    );

    new CfnOutput(this, "StorageBucketName", {
      value: this.bucket.bucketName,
      description: "S3 bucket dùng chung cho public/* và private/* objects."
    });

    new CfnOutput(this, "PublicPrefix", {
      value: `${PUBLIC_PREFIX}/`,
      description: "Object key nằm dưới prefix này có thể đọc public qua bucket policy."
    });

    new CfnOutput(this, "PrivatePrefix", {
      value: `${PRIVATE_PREFIX}/`,
      description: "Object key nằm dưới prefix này mặc định private, chỉ đọc qua IAM/presigned URL."
    });

    new CfnOutput(this, "PublicBaseUrl", {
      value: `https://${this.bucket.bucketName}.s3.${this.region}.amazonaws.com/${PUBLIC_PREFIX}`,
      description: "Base URL cho file public, ví dụ /avatars/user-123.png."
    });
  }
}
