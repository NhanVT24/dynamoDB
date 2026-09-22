import {
  CfnOutput,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface FrontendCertificateStackProps extends StackProps {
  readonly domainName: string;
  readonly hostedZoneDomainName: string;
  readonly subjectAlternativeNames?: string[];
}

export class FrontendCertificateStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendCertificateStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.hostedZoneDomainName
    });

    const certificate = new acm.Certificate(this, "FrontendCertificate", {
      domainName: props.domainName,
      subjectAlternativeNames: props.subjectAlternativeNames,
      validation: acm.CertificateValidation.fromDns(hostedZone)
    });

    new CfnOutput(this, "FrontendCertificateArn", {
      value: certificate.certificateArn,
      description: "ACM certificate ARN for CloudFront. Use this as FrontendCertificateArn."
    });
  }
}
