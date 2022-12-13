import * as codeBuild from 'aws-cdk-lib/aws-codebuild'
import { IVpc } from 'aws-cdk-lib/aws-ec2'
import { CommonConfigs } from '../model/configuration'

export function buildProject(stack: any,
    name: string,
    phases: any,
    vpc: IVpc,
    env: any,
    artifacts: any,
    isPrivileged: boolean) {
    return new codeBuild.PipelineProject(stack, name, {

        buildSpec: codeBuild.BuildSpec.fromObject({
            version: '0.2',
            env: { variables: env },
            phases: phases,
            artifacts: artifacts,

        }),
        vpc: vpc,
        environment: {
            buildImage: codeBuild.LinuxBuildImage.AMAZON_LINUX_2_4,
            privileged: isPrivileged
        },

    })
}

export function cdkBuildProject(stack: any, name: string, artifact: any, vpc: IVpc) {
    return buildProject(stack, name,
        {
            build: { commands: ['make install'] }
        },
        vpc,
        {
            // No environment variables
        },
        {
            'base-directory': 'cdk.out',
            "files": ['*.template.json'],
            "name": artifact
        },
        false)
}

export function lambdaBuildProject(stack: any, name: string, artifact: any, vpc: IVpc) {
    return buildProject(stack, name,
        {
            build: { commands: ['make pip.install'] }
        },
        vpc,
        {
            // No environment variables
        },
        {
            'base-directory': 'app',
            "files": ['**/*'],
            "name": artifact
        },
        false)
}