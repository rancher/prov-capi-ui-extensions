import type { ClusterProvisionerContext } from '@shell/core/types';

export const AWS_MACHINE_TEMPLATE_SCHEMA = 'infrastructure.cluster.x-k8s.io.awsmachinetemplate';
export const AWS_CLUSTER_SCHEMA = 'infrastructure.cluster.x-k8s.io.awscluster';
export type Translator = (key: string, args?: Record<string, any>) => string;
export type StringMap = Record<string, string>;
export type Tags = Record<string, string>;

export interface ResourceMetadata {
  name?: string;
  namespace?: string;
  generateName?: string;
  resourceVersion?: string;
  uid?: string;
}

export interface InfrastructureRef {
  kind?: string;
  name?: string;
  namespace?: string;
  apiVersion?: string;
}

export type SecurityGroupProtocol = '-1' | '4' | 'tcp' | 'udp' | 'icmp' | '58' | '50';

// ui only uses node, controlplane, apiserver-lb, lb
export type SecurityGroupRole = 'bastion' | 'node' | 'controlplane' | 'apiserver-lb' | 'lb' | 'node-eks-additional';

export interface IngressRule {
  description?: string;
  protocol: SecurityGroupProtocol;
  fromPort?: number;
  toPort?: number;
  cidrBlocks?: string[];
  ipv6CidrBlocks?: string[];
  sourceSecurityGroupIDs?: string[];
  sourceSecurityGroupRoles?: SecurityGroupRole[];
  natGatewaysIPsSource?: boolean;
}

export interface CNIIngressRule {
  description?: string;
  protocol: SecurityGroupProtocol;
  fromPort?: number;
  toPort?: number;
}

export interface CNISpec {
  cniIngressRules?: CNIIngressRule[];
}
export interface VPCSpec {
  id?: string;
  cidrBlock?: string;
  ipv6?: {};
}

export interface SubnetSpec {
  id: string;
}

export interface NetworkSpec {
  vpc?: VPCSpec;
  subnets?: SubnetSpec[];
  cni?: CNISpec;
  securityGroupOverrides?: Partial<Record<SecurityGroupRole, string>>;
  additionalControlPlaneIngressRules?: IngressRule[];
  additionalNodeIngressRules?: IngressRule[];
  nodePortIngressRuleCidrBlocks?: string[];
}

// ui only uses nlb loadbalancer type and TCP protocol
export type LoadBalancerType = 'classic' | 'elb' | 'alb' | 'nlb' | 'disabled';
export type ELBProtocol = 'TCP' | 'SSL' | 'HTTP' | 'HTTPS' | 'TLS' | 'UDP';

export interface AWSLoadBalancerSpec {
  healthCheckProtocol?: ELBProtocol;
  loadBalancerType?: LoadBalancerType;
}

// ui only uses AWSClusterStaticIdentity
export type AWSIdentityKind = 'AWSClusterControllerIdentity' | 'AWSClusterRoleIdentity' | 'AWSClusterStaticIdentity';

export interface AWSIdentityReference {
  name: string;
  kind: AWSIdentityKind;
}

export interface AWSClusterSpec {
  network?: NetworkSpec;
  region?: string;
  sshKeyName?: string;
  additionalTags?: Tags;
  controlPlaneLoadBalancer?: AWSLoadBalancerSpec;
  identityRef?: AWSIdentityReference;
  s3Bucket?: any;
}

export interface MachineTemplateSpec {
  template: {
    spec: {
      instanceType?: string;
      additionalTags?: StringMap;
      [key: string]: unknown;
    };
  };
  additionalTags?: StringMap;
  [key: string]: unknown;
}

export interface InfrastructureClusterResource {
  id?: string;
  type?: string;
  metadata: ResourceMetadata;
  spec: AWSClusterSpec;
  links?: Record<string, unknown>;
  save: () => Promise<InfrastructureClusterResource>;
  remove?: () => Promise<void>;
}

export interface InfrastructureMachineResource {
  id?: string;
  metadata: ResourceMetadata;
  spec: MachineTemplateSpec;
  links?: Record<string, unknown>;
  save: () => Promise<InfrastructureMachineResource>;
  remove?: () => Promise<void>;
}

export interface MachinePool {
  name: string;
  machineConfigRef: {
    name?: string;
  };
  [key: string]: unknown;
}

export interface RkeConfig {
  infrastructureRef?: InfrastructureRef;
  additionalManifest?: string;
  machineGlobalConfig?: Record<string, unknown>;
  machinePools?: MachinePool[];
}

export interface ClusterValue {
  metadata?: ResourceMetadata;
  spec: {
    rkeConfig?: RkeConfig;
  };
}

export interface PoolEntry {
  remove?: boolean;
  create?: boolean;
  update?: boolean;
  pool: MachinePool;
  config: InfrastructureMachineResource | null;
  oldConfig?: InfrastructureMachineResource | null;
}

export interface MachineConfigSchema {
  id?: string;
}

export interface RancherAwsCloudCredential {
  id?: string;
  annotations?: Record<string, string>;
  amazonec2credentialConfig?: {
    defaultRegion?: string;
    accessKey?: string;
    secretKey?: string;
  };
}

export type StoreContext = Pick<ClusterProvisionerContext, 'dispatch' | 'getters'> & {
  t?: Translator;
  $t?: Translator;
};
