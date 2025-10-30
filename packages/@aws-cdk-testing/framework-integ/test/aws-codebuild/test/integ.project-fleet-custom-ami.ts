import * as cdk from 'aws-cdk-lib';
import * as integ from '@aws-cdk/integ-tests-alpha';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ssm from 'aws-cdk-lib/aws-ssm';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'aws-cdk-project-fleet-custom-ami');

const latestAmazonLinux2AmiId = ssm.StringParameter.valueForStringParameter(
  stack,
  '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2',
);

const fleet = new codebuild.Fleet(stack, 'MyFleetWithCustomAmi', {
  fleetName: 'MyFleetWithCustomAmi',
  baseCapacity: 1,
  computeType: codebuild.FleetComputeType.SMALL,
  environmentType: codebuild.EnvironmentType.LINUX_EC2,
  amiId: latestAmazonLinux2AmiId,
});

const ec2BuildImage = {
  type: codebuild.EnvironmentType.LINUX_EC2.toString(),
  imageId: 'dummy',
  validate: () => [],
  runScriptBuildspec: () => codebuild.BuildSpec.fromObject({}),
  toJson: () => 'dummy',
};

const project = new codebuild.Project(stack, 'MyProject', {
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      build: { commands: ['echo "Testing custom AMI Fleet"'] },
    },
  }),
  environment: {
    fleet,
    buildImage: ec2BuildImage as any,
    computeType: codebuild.ComputeType.SMALL,
  },
});

const test = new integ.IntegTest(app, 'FleetCustomAmiIntegTest', {
  testCases: [stack],
});

const listFleets = test.assertions.awsApiCall('Codebuild', 'listFleets');
listFleets.expect(integ.ExpectedResult.objectLike({
  fleets: integ.Match.arrayWith([fleet.fleetArn]),
}));

const batchGetFleets = test.assertions.awsApiCall('CodeBuild', 'batchGetFleets', {
  names: [fleet.fleetName],
});
batchGetFleets.expect(integ.ExpectedResult.objectLike({
  fleets: integ.Match.arrayWith([
    integ.Match.objectLike({
      name: fleet.fleetName,
      environmentType: 'LINUX_EC2',
      imageId: integ.Match.stringLikeRegexp('/^ami-[a-f0-9]+$/'),
    }),
  ]),
}));

const startBuild = test.assertions.awsApiCall('Codebuild', 'startBuild', { projectName: project.projectName });

test.assertions.awsApiCall('CodeBuild', 'batchGetBuilds', {
  ids: [startBuild.getAttString('build.id')],
}).assertAtPath(
  'builds.0.buildStatus',
  integ.ExpectedResult.stringLikeRegexp('SUCCEEDED'),
).waitForAssertions({
  totalTimeout: cdk.Duration.minutes(5),
  interval: cdk.Duration.seconds(30),
});

app.synth();
