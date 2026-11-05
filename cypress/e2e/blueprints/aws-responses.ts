/**
 * Canned AWS API responses for the CAPA create form.
 *
 * The form talks to AWS through Rancher's /meta/proxy using the selected cloud credential. These
 * stand in for every call it makes (EC2 and IAM use the XML query protocol, KMS uses JSON), so the
 * suite needs no AWS account. Shapes match real responses; every id is made up.
 */

export const REGION = 'us-west-2';

export const VPC = { managed: 'vpc-0e2e00000000000a1', default: 'vpc-0e2e00000000000b2' };

export const SUBNETS = {
  a: 'subnet-0e2e0000000000a01', b: 'subnet-0e2e0000000000a02', other: 'subnet-0e2e0000000000b01'
};

export const KEY_PAIR = 'e2e-key-pair';

/** Two Ubuntu images. The form defaults the AMI to the newest by CreationDate. */
export const AMIS = { older: 'ami-0e2e000000000old1', latest: 'ami-0e2e00000000new02' };

export const INSTANCE_PROFILES = ['control-plane.cluster-api-provider-aws.sigs.k8s.io', 'nodes.cluster-api-provider-aws.sigs.k8s.io'];

export const INSTANCE_TYPES = ['t3.medium', 't3.large', 'm5.xlarge'];

export const KMS_KEY_ID = '0e2e0000-0000-4000-8000-000000000001';

const EC2_NS = 'http://ec2.amazonaws.com/doc/2016-11-15/';

const ec2 = (action: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<${ action }Response xmlns="${ EC2_NS }"><requestId>0e2e0000-0000-4000-8000-000000000000</requestId>${ body }</${ action }Response>`;

const tags = (t: Record<string, string>) => `<tagSet>${ Object.entries(t).map(([key, value]) => `<item><key>${ key }</key><value>${ value }</value></item>`).join('') }</tagSet>`;

const region = (name: string) => `<item><regionName>${ name }</regionName><regionEndpoint>ec2.${ name }.amazonaws.com</regionEndpoint><optInStatus>opt-in-not-required</optInStatus></item>`;

const vpc = (id: string, cidr: string, isDefault: boolean, name: string) => `<item><vpcId>${ id }</vpcId><ownerId>000000000000</ownerId><state>available</state><cidrBlock>${ cidr }</cidrBlock>` +
  `<instanceTenancy>default</instanceTenancy><isDefault>${ isDefault }</isDefault>${ tags({ Name: name }) }</item>`;

const subnet = (id: string, vpcId: string, cidr: string, az: string, name: string) => `<item><subnetId>${ id }</subnetId><state>available</state><ownerId>000000000000</ownerId>` +
  `<vpcId>${ vpcId }</vpcId><cidrBlock>${ cidr }</cidrBlock><availableIpAddressCount>4091</availableIpAddressCount><availabilityZone>${ az }</availabilityZone>` +
  `<defaultForAz>false</defaultForAz><mapPublicIpOnLaunch>false</mapPublicIpOnLaunch>${ tags({ Name: name }) }</item>`;

const securityGroup = (id: string, vpcId: string, name: string) => `<item><ownerId>000000000000</ownerId><groupId>${ id }</groupId><groupName>${ name }</groupName>` +
  `<groupDescription>${ name }</groupDescription><vpcId>${ vpcId }</vpcId><ipPermissions/><ipPermissionsEgress/></item>`;

const image = (id: string, created: string) => `<item><imageId>${ id }</imageId><imageState>available</imageState><imageOwnerId>099720109477</imageOwnerId>` +
  `<creationDate>${ created }</creationDate><isPublic>true</isPublic><architecture>x86_64</architecture><imageType>machine</imageType>` +
  `<name>ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-${ created.slice(0, 10).replace(/-/g, '') }</name><rootDeviceType>ebs</rootDeviceType>` +
  `<rootDeviceName>/dev/sda1</rootDeviceName><virtualizationType>hvm</virtualizationType></item>`;

const instanceType = (name: string, vcpus: number, memoryMiB: number) => `<item><currentGeneration>true</currentGeneration><instanceType>${ name }</instanceType>` +
  `<memoryInfo><sizeInMiB>${ memoryMiB }</sizeInMiB></memoryInfo><vCpuInfo><defaultVCpus>${ vcpus }</defaultVCpus></vCpuInfo>` +
  `<processorInfo><supportedArchitectures><item>x86_64</item></supportedArchitectures></processorInfo>` +
  `<supportedUsageClasses><item>on-demand</item><item>spot</item></supportedUsageClasses></item>`;

const instanceProfile = (name: string) => `<member><Path>/</Path><InstanceProfileName>${ name }</InstanceProfileName><Roles/>` +
  `<Arn>arn:aws:iam::000000000000:instance-profile/${ name }</Arn><InstanceProfileId>AIPA0E2E0000${ name.length }</InstanceProfileId><CreateDate>2026-01-01T00:00:00Z</CreateDate></member>`;

/** EC2 responses keyed by the `Action` form parameter of the request. */
export const EC2_RESPONSES: Record<string, string> = {
  DescribeRegions: ec2('DescribeRegions', `<regionInfo>${ ['eu-west-1', 'us-east-1', REGION].map(region).join('') }</regionInfo>`),
  DescribeVpcs:    ec2('DescribeVpcs', `<vpcSet>${ vpc(VPC.managed, '10.0.0.0/16', false, 'e2e-vpc') }${ vpc(VPC.default, '172.31.0.0/16', true, 'e2e-default-vpc') }</vpcSet>`),
  DescribeSubnets: ec2('DescribeSubnets', `<subnetSet>${ [
    subnet(SUBNETS.a, VPC.managed, '10.0.1.0/24', `${ REGION }a`, 'e2e-subnet-a'),
    subnet(SUBNETS.b, VPC.managed, '10.0.2.0/24', `${ REGION }b`, 'e2e-subnet-b'),
    subnet(SUBNETS.other, VPC.default, '172.31.0.0/20', `${ REGION }a`, 'e2e-default-subnet'),
  ].join('') }</subnetSet>`),
  DescribeSecurityGroups: ec2('DescribeSecurityGroups', `<securityGroupInfo>${ securityGroup('sg-0e2e0000000000a01', VPC.managed, 'e2e-sg') }${ securityGroup('sg-0e2e0000000000b01', VPC.default, 'default') }</securityGroupInfo>`),
  DescribeKeyPairs:       ec2('DescribeKeyPairs', `<keySet><item><keyName>${ KEY_PAIR }</keyName><keyPairId>key-0e2e00000000000a1</keyPairId><keyType>rsa</keyType><tagSet/></item></keySet>`),
  DescribeImages:         ec2('DescribeImages', `<imagesSet>${ image(AMIS.older, '2026-03-20T11:01:22.000Z') }${ image(AMIS.latest, '2026-06-04T11:03:42.000Z') }</imagesSet>`),
  DescribeInstanceTypes:  ec2('DescribeInstanceTypes', `<instanceTypeSet>${ instanceType('t3.medium', 2, 4096) }${ instanceType('t3.large', 2, 8192) }${ instanceType('m5.xlarge', 4, 16384) }</instanceTypeSet>`),
};

/** IAM responses keyed by the `Action` form parameter of the request. */
export const IAM_RESPONSES: Record<string, string> = {
  ListInstanceProfiles: `<ListInstanceProfilesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><ListInstanceProfilesResult><IsTruncated>false</IsTruncated>` +
    `<InstanceProfiles>${ INSTANCE_PROFILES.map(instanceProfile).join('') }</InstanceProfiles></ListInstanceProfilesResult>` +
    `<ResponseMetadata><RequestId>0e2e0000-0000-4000-8000-000000000000</RequestId></ResponseMetadata></ListInstanceProfilesResponse>`,
};

/** KMS responses keyed by the `X-Amz-Target` header of the request (JSON protocol). */
export const KMS_RESPONSES: Record<string, object> = {
  'TrentService.ListKeys': {
    KeyCount: 1, Keys: [{ KeyArn: `arn:aws:kms:${ REGION }:000000000000:key/${ KMS_KEY_ID }`, KeyId: KMS_KEY_ID }], Truncated: false
  },
};
