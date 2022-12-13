import { Duration, Stack, StackProps, RemovalPolicy, CfnParameter } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secm from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
const yaml = require("js-yaml");
const fs = require("fs");

import { CommonConfigs, ApplicationConfig } from './model/configuration';
import { ImagePullPrincipalType } from 'aws-cdk-lib/aws-codebuild';

export interface ApplicationStackProps extends StackProps {
  readonly commonConfigs: CommonConfigs;
  readonly appConfigs: ApplicationConfig;
  readonly stackName: string;
}

export class ApplicationStack extends Stack {

  public readonly lambdaCode: lambda.CfnParametersCode;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const commonConfigs = props.commonConfigs;
    const appConfigs = props.appConfigs;
    const stackName = props.stackName
    this.lambdaCode = lambda.Code.fromCfnParameters();

    function getValueFromParameterStore(name: string, stack: Construct) {
      return (ssm.StringParameter.fromStringParameterAttributes(stack, `${name}Parameter`, {
        parameterName: name
      })).stringValue
    }

    function getSubnet(name: string, stack: Construct) {
      return ec2.Subnet.fromSubnetId(stack, `${name}Parameter`, name).subnetId
    }

    const vpcId = getValueFromParameterStore(commonConfigs.vpcInfo.vpcId, this)
    const availabilityZones = getValueFromParameterStore(commonConfigs.vpcInfo.availabilityZones, this)
    const publicSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnets, this)
    const privateSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnets, this)

    //Needed Imports
    const vpc = ec2.Vpc.fromVpcAttributes(this, `${stackName}VPCImport`, {
      vpcId: vpcId,
      availabilityZones: [availabilityZones],
      privateSubnetIds: [
        getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetA, this), this),
        getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetB, this), this),
        getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetC, this), this)
      ]

    })

    //Lambda function
    const lambdaFunction = new lambda.Function(this, `${stackName}Lambda`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      // vpc: vpc,
      code: this.lambdaCode,
      // code: lambda.Code.fromAsset('app'),
      handler: "app.handler",
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      memorySize: 512
    })

    //This loads the Open API spec from a file and adds lambda as backend
    const apiDef = JSON.parse(JSON.stringify(yaml.load(fs.readFileSync("./lib/model/openapispec.yaml", "utf-8"))).replace(
      /LAMBDA_ARN_VALUE/g, `${commonConfigs.lambda_prefix}${lambdaFunction.functionArn}/invocations`
    ))

    //Create API Gateway with the API Spec
    const apiGateway = new apigw.SpecRestApi(this, `${stackName}API`, {
      apiDefinition: apigw.ApiDefinition.fromInline(apiDef),
      failOnWarnings: true,
      cloudWatchRole: true,
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deploy: true,
      deployOptions: { stageName: "v1", tracingEnabled: true },
    })

    //Add permission to api gateway to invoke lambda
    lambdaFunction.addPermission(`${stackName}APIInvocation`, {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: apiGateway.arnForExecuteApi()
    })

    //Create and store the api key in secrets manager
    const apiSecret = new secm.Secret(this, `${stackName}Secret`, {
      secretName: "/secret/lambdaDemo/apiKey",
      generateSecretString: {
        generateStringKey: "api_key",
        secretStringTemplate: JSON.stringify({}),
        excludePunctuation: true,
        includeSpace: false,
        excludeCharacters: "'\\/"
      }
    })

    const apiKey = apiGateway.addApiKey(`${stackName}APIKey`, {
      apiKeyName: `${stackName}APIKey`,
      value: apiSecret.secretValueFromJson("api_key").unsafeUnwrap()
    })

    //Create a usage plan with the api key
    const usagePlan = apiGateway.addUsagePlan(`${stackName}UsagePlan`, {
      name: `${stackName}UsagePlan`
    })

    usagePlan.addApiKey(apiKey)


    //Commented as domain is not available now. Use it as needed.
    /*
    const hostedZone = r53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone',{
      hostedZoneId: getValueFromParameterStore(commonConfigs.route53.zoneId, this),
      zoneName: getValueFromParameterStore(commonConfigs.route53.zoneName, this)
    })
     const customDomain = apiGateway.addDomainName(`${stackName}Domain`, {
       domainName: "FULLY_QUALIFIED_DOMAIN_NAME_HERE",
       certificate: acm.Certificate.fromCertificateArn(this, `${stackName}Certificate`, "CERTIFICATE_ARN_HERE")
     })
     const aRecord = new r53.ARecord(this, 'demoAPIr53Record',{
       zone: hostedZone,
       target: r53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(customDomain)),
       recordName: commonConfigs.route53.recordName
     })
     */



  }


}
