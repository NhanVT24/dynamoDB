import {
  CfnOutput,
  Fn,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface DomainHostedZoneStackProps extends StackProps {
  readonly zoneName: string;
}

export class DomainHostedZoneStack extends Stack {
  constructor(scope: Construct, id: string, props: DomainHostedZoneStackProps) {
    super(scope, id, props);

    // Route53 hosted zone is the public DNS authority for the root domain.
    // The registrar must delegate the domain to these AWS nameservers before
    // any A/AAAA Alias records below can work on the public internet.
    const hostedZone = new route53.PublicHostedZone(this, "HostedZone", {
      zoneName: props.zoneName
    });

    new CfnOutput(this, "HostedZoneId", {
      value: hostedZone.hostedZoneId,
      description: "Route53 public hosted zone id."
    });

    new CfnOutput(this, "HostedZoneNameServers", {
      value: hostedZone.hostedZoneNameServers ? Fn.join(",", hostedZone.hostedZoneNameServers) : "",
      description: "Set these nameservers at the domain registrar if the domain was not bought in Route53."
    });
  }
}
