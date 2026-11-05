/**
 * Canned AWS API responses (as returned by the dashboard's `aws/depaginateList` action) shared by the
 * component tests.
 */

export const REGIONS = [
  { RegionName: 'us-west-2' },
  { RegionName: 'eu-west-1' },
  { RegionName: 'us-east-1' },
];

export const KEY_PAIRS = [
  { KeyName: 'alice' },
  { KeyName: 'bob' },
  { KeyPairId: 'no-name' },
];

export const VPCS = [
  {
    VpcId: 'vpc-capa',
    Tags:  [
      { Key: 'Name', Value: 'capa-made' },
      { Key: 'sigs.k8s.io/cluster-api-provider-aws/cluster/my-cluster', Value: 'owned' },
    ],
  },
  { VpcId: 'vpc-user', Tags: [{ Key: 'Name', Value: 'my-vpc' }] },
  { VpcId: 'vpc-untagged' },
];

export const SUBNETS = [
  {
    SubnetId: 'subnet-b', VpcId: 'vpc-user', Tags: [{ Key: 'Name', Value: 'private-b' }]
  },
  {
    SubnetId: 'subnet-a', VpcId: 'vpc-user', Tags: [{ Key: 'Name', Value: 'private-a' }]
  },
  { SubnetId: 'subnet-c', VpcId: 'vpc-capa' },
];

export const SECURITY_GROUPS = [
  {
    GroupId: 'sg-1', GroupName: 'default', Description: 'default sg', VpcId: 'vpc-user'
  },
  {
    GroupId: 'sg-2', GroupName: 'web', Description: 'web sg', VpcId: 'vpc-user'
  },
  {
    GroupId: 'sg-3', GroupName: 'other', Description: 'other sg', VpcId: 'vpc-capa'
  },
];

export const INSTANCE_PROFILES = [
  { InstanceProfileName: 'nodes.cluster-api-provider-aws.sigs.k8s.io' },
  { InstanceProfileName: 'control-plane.cluster-api-provider-aws.sigs.k8s.io' },
  { Arn: 'no-name' },
];

export const KMS_KEYS = [
  { KeyId: 'key-1', KeyArn: 'arn:aws:kms:us-west-2:123:key/key-1' },
  { KeyId: 'key-2', KeyArn: 'arn:aws:kms:us-west-2:123:key/key-2' },
];

// Shape returned by the dashboard's `aws/describeInstanceTypes` action
export const INSTANCE_TYPES = [
  {
    apiName: 't3.medium', label: 't3.medium - 2 vCPU, 4 GiB', groupLabel: 'General Purpose'
  },
  {
    apiName: 't3.large', label: 't3.large - 2 vCPU, 8 GiB', groupLabel: 'General Purpose'
  },
  {
    apiName: 'c5.large', label: 'c5.large - 2 vCPU, 4 GiB', groupLabel: 'Compute Optimized'
  },
];

export const UBUNTU_IMAGES = [
  { ImageId: 'ami-old', CreationDate: '2024-01-01T00:00:00.000Z' },
  { ImageId: 'ami-new', CreationDate: '2025-06-01T00:00:00.000Z' },
  { ImageId: 'ami-no-date' },
];

export const DEPAGINATED: Record<string, unknown[]> = {
  describeRegions:        REGIONS,
  describeKeyPairs:       KEY_PAIRS,
  describeVpcs:           VPCS,
  describeSubnets:        SUBNETS,
  describeSecurityGroups: SECURITY_GROUPS,
  listInstanceProfiles:   INSTANCE_PROFILES,
  listKeys:               KMS_KEYS,
  describeImages:         UBUNTU_IMAGES,
};

/**
 * A fake vuex store answering the `aws/*` actions used by the CAPA components. Individual actions can
 * be overridden (e.g. to make them fail) with `overrides`.
 */
export const createAwsStore = (overrides: Record<string, (payload: any) => any> = {}, getters: Record<string, any> = {}) => {
  const dispatch = jest.fn(async(action: string, payload: any = {}) => {
    if (overrides[action]) {
      return overrides[action](payload);
    }

    switch (action) {
    case 'aws/ec2':
      return { client: 'ec2', region: payload.region };
    case 'aws/iam':
      return { client: 'iam', region: payload.region };
    case 'aws/kms':
      return { client: 'kms', region: payload.region };
    case 'aws/depaginateList':
      return DEPAGINATED[payload.cmd];
    case 'aws/describeInstanceTypes':
      return INSTANCE_TYPES;
    default:
      return undefined;
    }
  });

  return {
    dispatch,
    commit:  jest.fn(),
    getters: {
      'aws/defaultRegion': 'us-west-2',
      'i18n/t':            (key: string) => `%${ key }%`,
      'i18n/exists':       () => true,
      'prefs/get':         () => undefined,
      ...getters,
    },
  };
};

export const depaginateCalls = (dispatch: jest.Mock) => dispatch.mock.calls
  .filter(([action]) => action === 'aws/depaginateList')
  .map(([, payload]) => payload.cmd);
