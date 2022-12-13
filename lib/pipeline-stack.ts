import * as codepipeline from 'aws-cdk-lib/aws-codepipeline'
import * as codeCommit from 'aws-cdk-lib/aws-codecommit'
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions'
import { App, Stack, StackProps, SecretValue } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { CommonConfigs, ApplicationConfig } from './model/configuration';
import { ApplicationStack } from './Application-stack';

import * as util from './utils/util'

export interface PipelineProps extends StackProps {
  readonly commonConfigs: CommonConfigs
  readonly nonProdApplicationStack: ApplicationStack
  readonly nonProdConfigs: ApplicationConfig
  readonly prodApplicationStack: ApplicationStack
  readonly prodConfigs: ApplicationConfig
  readonly stackName: string

}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineProps) {
    super(app, id, props);

    const commonConfigs = props.commonConfigs
    const nonProdApplicationStack = props.nonProdApplicationStack
    const prodApplicationStack = props.prodApplicationStack
    const stackName = props.stackName;
    function getValueFromParameterStore(name: string, stack: Construct) {
      return (ssm.StringParameter.fromStringParameterAttributes(stack, `${name}Parameter`, {
        parameterName: name
      })).stringValue
    }


    const vpcId = getValueFromParameterStore(commonConfigs.vpcInfo.vpcId, this)

    const availabilityZones = getValueFromParameterStore(commonConfigs.vpcInfo.availabilityZones, this)

    const privateSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnets, this).split(",")
    const publicSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnets, this).split(",")

    const vpc = ec2.Vpc.fromVpcAttributes(this, `${stackName}VPCImport`, {
      vpcId: vpcId,
      availabilityZones: [availabilityZones],
      privateSubnetIds: [
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetA, this),
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetB, this),
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetC, this),
      ]
    })


    //Some required imports
    const kms_key = kms.Key.fromKeyArn(this, "EncryptionKey",
      getValueFromParameterStore(commonConfigs.kms.arn, this))

    const prodDeployRole = iam.Role.fromRoleArn(this, "ProdDeployRole",
      getValueFromParameterStore(commonConfigs.roles.deployRole, this), { mutable: false })

    const crossAccountRole = iam.Role.fromRoleArn(this, "CrossAccountRole",
      getValueFromParameterStore(commonConfigs.roles.crossAccountRole, this), { mutable: false })

    const artifactBucket = s3.Bucket.fromBucketAttributes(this, `${stackName}ArtifactBucket`, {
      bucketName: getValueFromParameterStore(commonConfigs.artifactBucket, this),
      encryptionKey: kms_key,
    })
    const codeRepository = codeCommit.Repository.fromRepositoryName(this, `${commonConfigs.appName}Repository`,
      commonConfigs.codeRepo.name)

    //Artifacts
    const sourceOut = new codepipeline.Artifact("sourceOut")
    const cdkBuildOut = new codepipeline.Artifact("cdkBuildOut")
    const lambdaBuildOut = new codepipeline.Artifact("lambdaBuildOut")


    //CodeBuild Projects for build
    const cdkBuild = util.cdkBuildProject(this, `${stackName}CDKBuild`, cdkBuildOut.artifactName, vpc)

    //CodeBuild Projects for build
    const lambdaBuild = util.lambdaBuildProject(this, `${stackName}LambdaBuild`, lambdaBuildOut.artifactName, vpc)
    artifactBucket.grantReadWrite(cdkBuild)
    artifactBucket.grantReadWrite(lambdaBuild)

    //Pipeline
    const pipeline = new codepipeline.Pipeline(this, `${commonConfigs.appName}Pipeline`, {
      restartExecutionOnUpdate: true,
      artifactBucket: artifactBucket,
      crossAccountKeys: true,
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipeline_actions.GitHubSourceAction(
              {
                actionName: "Github_Pull",
                repo: commonConfigs.codeRepo.name,
                owner: "tsk811",
                oauthToken: SecretValue.secretsManager(commonConfigs.github_secret.name, {
                  jsonField: commonConfigs.github_secret.key
                }),
                output: sourceOut,
                branch: commonConfigs.codeRepo.defaultBranch
              })
          ]

        },
        {
          stageName: "Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "CDK_Build",
              input: sourceOut,
              project: cdkBuild,
              outputs: [cdkBuildOut]

            })
          ]
        },
        {
          stageName: "Pipeline_Update",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Self_Mutate",
              templatePath: cdkBuildOut.atPath(`${stackName}.template.json`),
              stackName: stackName,
              adminPermissions: true
            })
          ]
        },
        {
          stageName: "Application_Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "Lambda_Build",
              input: sourceOut,
              project: lambdaBuild,
              outputs: [lambdaBuildOut]

            })
          ]
        },
        {
          stageName: "Non_Prod_Deployment",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_Non_Prod_Application_Stack",
              templatePath: cdkBuildOut.atPath(`${nonProdApplicationStack.stackName}.template.json`),
              stackName: nonProdApplicationStack.stackName,
              adminPermissions: true,
              parameterOverrides: {
                ...nonProdApplicationStack.lambdaCode.assign(lambdaBuildOut.s3Location)
              },
              extraInputs: [lambdaBuildOut]
            })
          ]
        },
        {
          stageName: "Approval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              // notifyEmails:"Emailhere".
            })
          ]
        },
        {
          stageName: "Prod_Deployment",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_Prod_Application_Stack",
              templatePath: cdkBuildOut.atPath(`${prodApplicationStack.stackName}.template.json`),
              stackName: prodApplicationStack.stackName,
              parameterOverrides: {
                ...prodApplicationStack.lambdaCode.assign(lambdaBuildOut.s3Location)
              },
              extraInputs: [lambdaBuildOut],
              adminPermissions: true,
              role: crossAccountRole,
              deploymentRole: prodDeployRole
            })]
        }
      ]
    })


  }
}
