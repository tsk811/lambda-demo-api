

//Common models
export interface CommonConfigs {
    vpcInfo: vpcConfigs
    account: Account
    appName: string
    artifactBucket: string
    codeRepo: CodeRepo
    route53: Route53
    kms: KMS
    roles: Roles
    github_secret: SecretsManager
    lambda_prefix: string
}

export interface Account {
    nonProd: string
    prod: string
    region: string
}

export interface CodeRepo {
    name: string
    defaultBranch: string
}

export interface Route53 {
    zoneId: string
    zoneName: string
    recordName: string
}

interface vpcConfigs {
    vpcId: string
    availabilityZones: string
    publicSubnets: string
    privateSubnets: string
    privateSubnetA: string
    privateSubnetB: string
    privateSubnetC: string
    publicSubnetA: string
    publicSubnetB: string
    publicSubnetC: string
}

export interface KMS {
    arn: string
}

export interface Roles {
    deployRole: string
    crossAccountRole: string
}

//Application related models
export interface ApplicationConfig {
    environment: string
}

export interface SecretsManager {
    name: string
    key: string
}