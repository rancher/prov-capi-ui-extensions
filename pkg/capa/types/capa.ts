import type { ClusterProvisionerContext } from '@shell/core/types';

export const AWS_MACHINE_TEMPLATE_SCHEMA = 'infrastructure.cluster.x-k8s.io.awsmachinetemplate';
export const AWS_CLUSTER_SCHEMA = 'infrastructure.cluster.x-k8s.io.awscluster';
export type Translator = (key: string, args?: Record<string, any>) => string;
export type StringMap = Record<string, string>;

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
  metadata: ResourceMetadata;
  spec: MachineTemplateSpec;
  links?: Record<string, unknown>;
  save: () => Promise<InfrastructureClusterResource>;
  remove?: () => Promise<void>;
}
export interface MachinePool {
  name: string;
  machineConfigRef: {
    name?: string;
  };
  [key: string]: unknown;
}
export interface PoolEntry {
  remove?: boolean;
  create?: boolean;
  update?: boolean;
  pool: MachinePool;
  config: InfrastructureClusterResource;
}
export interface MachineConfigSchema {
  id?: string;
}
export type StoreContext = Pick<ClusterProvisionerContext, 'dispatch' | 'getters'> & {
  t?: Translator;
  $t?: Translator;
};
