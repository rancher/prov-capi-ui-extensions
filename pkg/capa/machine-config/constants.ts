import type { VolumeType } from '@aws-sdk/client-ec2';

export type { VolumeType } from '@aws-sdk/client-ec2';

// AWS has no API to list EBS volume types - they are a fixed enum on the EC2
// CreateVolume `VolumeType` parameter. Kept as an explicit list (gp3 first, the
// recommended default) but typed against the SDK enum so it stays valid.
export const VOLUME_TYPES: VolumeType[] = [
  'gp3',
  'gp2',
  'io2',
  'io1',
  'st1',
  'sc1',
  'standard',
];

export const VOLUME_TYPE_OPTIONS: { label: string; value: VolumeType }[] = VOLUME_TYPES.map((t) => ({
  label: t,
  value: t,
}));

export const HTTP_TOKENS_VALUES = {
  REQUIRED: 'required',
  OPTIONAL: 'optional',
} as const;

export const MARKET_TYPES = {
  ON_DEMAND: 'OnDemand',
  SPOT:      'Spot',
  BLOCK:     'CapacityBlock',
} as const;

export const SECURITY_GROUP_OPTIONS = [
  { labelKey: 'capa.machineConfig.advanced.securityGroup.options.standard', value: 'merge' },
  { labelKey: 'capa.machineConfig.advanced.securityGroup.options.existing', value: 'replace' },
] as const;

export const SECURITY_GROUP_ROLES = [
  'node',
  'controlplane',
  'apiserver-lb',
  'lb'
] as const;

export const UBUNTU_LTS_AMI_NAME_PATTERNS = [
  'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*',
  'ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-*',
  'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*',
] as const;

export const MACHINE_CONFIG_DEFAULTS = {
  ami:                     {},
  cloudInit:               { insecureSkipSecretsManager: true },
  iamInstanceProfile:      '',
  instanceMetadataOptions: { httpTokens: HTTP_TOKENS_VALUES.REQUIRED },
  instanceType:            't3.medium',
  marketType:              MARKET_TYPES.ON_DEMAND,
  publicIP:                false,
  rootVolume:              {
    encrypted: false,
    size:      32,
    type:      'gp3',
  },
  sshKeyName:     '',
  privateDnsName: { hostnameType: 'resource-name' },
} as const;

export const NON_ROOT_VOLUME_DEFAULT = {
  deviceName: '',
  type:       MACHINE_CONFIG_DEFAULTS.rootVolume.type,
  size:       null as number | null,
} as const;

