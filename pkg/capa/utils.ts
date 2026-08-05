import { normalizeName } from '@shell/utils/kube';
import { DEFAULT_WORKSPACE } from '@shell/config/types';
import { set, diff, isEmpty } from '@shell/utils/object';
import { createDoNotLogError } from '@shell/utils/error';
import { handleConflict } from '@shell/plugins/dashboard-store/normalize';
import {
  AWS_MACHINE_TEMPLATE_SCHEMA, AWS_CLUSTER_SCHEMA, InfrastructureClusterResource, InfrastructureMachineResource, ClusterValue, MachineConfigSchema, MachinePool, PoolEntry, StoreContext
} from './types/capa';
import * as AWS from '@shell/types/aws-sdk';
import { CAPA } from './labels-annotations';

const ADDITIONAL_MANIFEST = `apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: aws-cloud-controller-manager
  namespace: kube-system
spec:
  chart: aws-cloud-controller-manager
  repo: https://kubernetes.github.io/cloud-provider-aws
  targetNamespace: kube-system
  bootstrap: true
  valuesContent: |-
    hostNetworking: true
    nodeSelector:
      node-role.kubernetes.io/control-plane: "true"
    args:
      - --configure-cloud-routes=false
      - --v=5
      - --cloud-provider=aws
    tolerations:
      - key: node.cloudprovider.kubernetes.io/uninitialized
        value: "true"
        effect: NoSchedule
      - key: node-role.kubernetes.io/master
        effect: NoSchedule
      - key: node-role.kubernetes.io/control-plane
        effect: NoSchedule
      - key: node-role.kubernetes.io/etcd
        effect: NoExecute`;

const MACHINE_SELECTOR_CONFIG_RKE2 = [
  {
    config: {
      'disable-cloud-controller': 'true',
      machineLabelSelector:       {
        matchExpressions: [
          {
            key:      'rke.cattle.io/control-plane-role',
            operator: 'In',
            values:   ['true']
          }
        ]
      }
    }
  },
  {
    config: {
      'disable-cloud-controller': 'true',
      machineLabelSelector:       {
        matchExpressions: [
          {
            key:      'rke.cattle.io/etcd-role',
            operator: 'In',
            values:   ['true']
          }
        ]
      }
    }
  }
];

const MACHINE_SELECTOR_CONFIG_K3S = [
  {
    config: {
      'disable-cloud-controller':    'true',
      'kube-controller-manager-arg': [
        'cloud-provider=external'
      ],
      'kubelet-arg': [
        'cloud-provider=external'
      ]
    },
    machineLabelSelector: {
      matchExpressions: [
        {
          key:      'rke.cattle.io/control-plane-role',
          operator: 'In',
          values:   ['true']
        }
      ]
    }
  },
  {
    config: {
      'disable-cloud-controller': 'true',
      'kubelet-arg':              [
        'cloud-provider=external'
      ]
    },
    machineLabelSelector: {
      matchExpressions: [
        {
          key:      'rke.cattle.io/etcd-role',
          operator: 'In',
          values:   ['true']
        }
      ]
    }
  },
  {
    config: {
      'kubelet-arg': [
        'cloud-provider=external'
      ]
    },
    machineLabelSelector: {
      matchExpressions: [
        {
          key:      'rke.cattle.io/worker-role',
          operator: 'In',
          values:   ['true']
        }
      ]
    }
  }
];

function formatErrorMessage(context: StoreContext, key: string, e?: any): string {
  const error = e instanceof Error || e?.message ? e.message : String(e);
  const t = context.t || context.$t;

  return t ? t(key, { error }) : `${ key }: ${ error }`;
}

function isConflictError(e: any): boolean {
  const code = e?.status ?? e?._status ?? e?.code;
  const message = (e?.message || e?._message || String(e || '')).toLowerCase();

  return code === 409 || code === '409' || message.includes('the object has been modified');
}

async function saveWithConflictResolution(
  initial: InfrastructureClusterResource | null | undefined,
  userValue: InfrastructureClusterResource,
  context: StoreContext,
  attempts = 3,
): Promise<InfrastructureClusterResource> {
  const type = userValue.type || AWS_CLUSTER_SCHEMA;
  const id = `${ userValue.metadata.namespace }/${ userValue.metadata.name }`;

  let lastError: any;

  for (let depth = 0; depth < attempts; depth++) {
    try {
      return await userValue.save();
    } catch (e) {
      lastError = e;

      if (!isConflictError(e) || !userValue.metadata?.name) {
        throw e;
      }

      const server = await context.dispatch('management/find', {
        type,
        id,
        opt: { force: true, watch: false },
      }) as InfrastructureClusterResource;

      if (initial && typeof (initial as any).toJSON === 'function') {
        const conflicts = await handleConflict(
          initial,
          userValue,
          server,
          { dispatch: context.dispatch, getters: context.getters },
          'management',
        );

        // Genuine conflict: the user edited fields the controller also changed.
        if (conflicts !== false) {
          throw new Error(Array.isArray(conflicts) ? conflicts.join(', ') : String(conflicts));
        }
      } else {
        userValue.metadata.resourceVersion = server?.metadata?.resourceVersion;
      }
    }
  }

  throw lastError;
}

async function patchInfrastructureClusterChanges(
  initial: InfrastructureClusterResource | null | undefined,
  userValue: InfrastructureClusterResource,
  context: StoreContext,
): Promise<boolean> {
  if (!initial || typeof (initial as any).toJSON !== 'function' || typeof (userValue as any).patch !== 'function') {
    await saveWithConflictResolution(initial, userValue, context);

    return true;
  }

  const initialClean = await context.dispatch('management/cleanForDiff', (initial as any).toJSON());
  const userClean = await context.dispatch('management/cleanForDiff', (userValue as any).toJSON());

  const patch = diff(initialClean, userClean);

  delete patch.type;
  delete patch.apiVersion;
  delete patch.kind;
  delete patch.id;
  delete patch.metadata;

  if (isEmpty(patch)) {
    return false;
  }

  await (userValue as any).patch(patch, { headers: { 'content-type': 'application/merge-patch+json' } });

  return true;
}

function serializeResource(resource: any): any {
  return typeof resource?.toJSON === 'function' ? resource.toJSON() : resource;
}

async function machineConfigWasModified(entry: PoolEntry, context: StoreContext): Promise<boolean> {
  const config = entry.config as any;

  if (!config?.metadata?.name) {
    return true;
  }

  try {
    const type = config.type || config._type || AWS_MACHINE_TEMPLATE_SCHEMA;
    const id = config.id || `${ config.metadata.namespace || DEFAULT_WORKSPACE }/${ config.metadata.name }`;
    const server = await context.dispatch('management/find', {
      type,
      id,
      opt: { force: true, watch: false },
    });

    const serverClean = await context.dispatch('management/cleanForDiff', serializeResource(server));
    const configClean = await context.dispatch('management/cleanForDiff', serializeResource(config));

    return !isEmpty(diff(serverClean, configClean));
  } catch (e) {
    // If comparison fails, preserve previous behavior and recreate the template.
    return true;
  }
}
export async function prepareProvCluster(cluster: any): Promise<void> {
  const isK3s = (cluster?.spec?.kubernetesVersion || '').includes('k3s');
  const MACHINE_SELECTOR_CONFIG = isK3s ? MACHINE_SELECTOR_CONFIG_K3S : MACHINE_SELECTOR_CONFIG_RKE2;

  if (!cluster?.spec?.rkeConfig?.additionalManifest) {
    set(cluster, 'spec.rkeConfig.additionalManifest', ADDITIONAL_MANIFEST);
  }

  if (cluster?.agentConfig?.['cloud-provider-name'] !== 'external') {
    set(cluster, 'agentConfig.cloud-provider-name', 'external');
  }
  if (!cluster?.spec?.rkeConfig?.machineSelectorConfig) {
    set(cluster, 'spec.rkeConfig.machineSelectorConfig', MACHINE_SELECTOR_CONFIG);
  } else {
    const selectorConfig: any[] = cluster?.spec?.rkeConfig?.machineSelectorConfig || [];
    const allPresent = MACHINE_SELECTOR_CONFIG.every((required) => selectorConfig.some((entry) => JSON.stringify(entry) === JSON.stringify(required)));

    if (!allPresent) {
      set(cluster, 'spec.rkeConfig.machineSelectorConfig', [...selectorConfig, ...MACHINE_SELECTOR_CONFIG]);
    }
  }
}

export function provisioningClusterValidation(cluster: any): void {
  const isK3s = (cluster?.spec?.kubernetesVersion || '').includes('k3s');
  const MACHINE_SELECTOR_CONFIG = isK3s ? MACHINE_SELECTOR_CONFIG_K3S : MACHINE_SELECTOR_CONFIG_RKE2;

  if (!cluster?.spec?.rkeConfig?.additionalManifest) {
    throw createDoNotLogError('capa.errors.missingAdditionalManifest');
  }

  if (cluster.agentConfig?.['cloud-provider-name'] !== 'external') {
    throw createDoNotLogError('capa.errors.invalidCloudProviderName');
  }

  const selectorConfig: any[] = cluster?.spec?.rkeConfig?.machineSelectorConfig || [];
  const allPresent = MACHINE_SELECTOR_CONFIG.every((required) => selectorConfig.some((entry) => JSON.stringify(entry) === JSON.stringify(required))
  );

  if (!allPresent) {
    throw createDoNotLogError('capa.errors.missingMachineSelectorConfig');
  }
}

export async function initInfrastructureCluster(value: ClusterValue, clusterSchema: string, context: StoreContext): Promise<InfrastructureClusterResource | {} | undefined> {
  let config: InfrastructureClusterResource | undefined;
  let configMissing = false;

  if (!clusterSchema) {
    // eslint-disable-next-line no-console
    console.warn('initCapiCluster: missing clusterSchema, cluster object creation skipped');
  }

  if (clusterSchema && context.getters['management/canList'](clusterSchema)) {
    try {
      const infraRef = value.spec?.rkeConfig?.infrastructureRef;

      if (infraRef?.name && infraRef?.namespace) {
        config = await context.dispatch('management/find', {
          type: clusterSchema,
          id:   `${ infraRef.namespace }/${ infraRef.name }`,
        }) as InfrastructureClusterResource | undefined;
        // label-based fallback
      } else if (value.metadata?.name) {
        config = await context.dispatch('management/find', {
          type:     clusterSchema,
          selector: `cluster.x-k8s.io/cluster-name=${ value.metadata.name }`,
        }) as InfrastructureClusterResource | undefined;
      }

      if (!config) {
        configMissing = true;
      }
    } catch (e) {
      configMissing = true;
    }
    if (configMissing) {
      try {
        config = await context.dispatch('management/create', {
          type:     clusterSchema,
          metadata: { namespace: DEFAULT_WORKSPACE }
        }) as InfrastructureClusterResource;
      } catch (e) {
        throw new Error(formatErrorMessage(context, 'capa.errors.creatingInfrastructureClusterConfig', e));
      }
    }
    if (config && typeof (config as any).toJSON === 'function') {
      config = await context.dispatch('management/clone', { resource: config }) as InfrastructureClusterResource;
    }

    if (config) {
      config.spec = removeEmptyFields(config.spec) || {};
    }

    return config || {};
  }
}

export async function createMachinePoolMachineConfig(machineConfigSchema: MachineConfigSchema | undefined, context: StoreContext): Promise<InfrastructureMachineResource | Record<string, never>> {
  const machineConfigType = machineConfigSchema?.id || AWS_MACHINE_TEMPLATE_SCHEMA;

  await context.dispatch('management/waitForSchema', { type: machineConfigType });

  const createConfig = await context.dispatch('management/create', {
    type:     machineConfigType,
    metadata: { namespace: DEFAULT_WORKSPACE }
  }) as InfrastructureMachineResource | undefined;

  const config = createConfig || {};

  return config;
}

export async function saveMachinePoolConfigs(pools: PoolEntry[], cluster: ClusterValue, context: StoreContext): Promise<void> {
  const finalPools: MachinePool[] = [];
  const clusterName = cluster.metadata?.name || 'cluster';

  for (const entry of pools) {
    if (entry.remove) {
      continue;
    }

    entry.pool.name = normalizeName(entry.pool.name) || 'pool';
    const prefix = `${ clusterName }-${ entry.pool.name }`;

    const prefixFormatted = prefix.slice(0, 50).toLowerCase();

    try {
      if (entry.create) {
        if (!entry.config) {
          throw new Error(`Missing machine config for pool "${ entry.pool.name }"`);
        }

        if (!entry.config.metadata?.name) {
          entry.config.metadata.generateName = `nc-${ prefixFormatted }-`;
        }

        const neu = await entry.config.save();

        entry.config = neu;
        entry.pool.machineConfigRef.name = neu.metadata.name;
        entry.create = false;
        entry.update = true;
      } else if (entry.update) {
        // Upstream CAPI machine templates are immutable: create a replacement resource
        // with the current spec values, update the pool reference, then remove the old one.
        if (!await machineConfigWasModified(entry, context)) {
          finalPools.push(entry.pool);
          continue;
        }

        const oldConfig = entry.config;

        if (!oldConfig) {
          finalPools.push(entry.pool);
          continue;
        }

        // Clone before mutating so oldConfig retains its identity (links/id) for removal.
        const newConfig = await context.dispatch('management/clone', { resource: oldConfig }) as InfrastructureMachineResource;

        delete newConfig.id;
        delete newConfig.metadata.name;
        delete newConfig.metadata.resourceVersion;
        delete newConfig.metadata.uid;
        delete newConfig.links;
        newConfig.metadata.generateName = `nc-${ prefixFormatted }-`;

        const neu = await newConfig.save();

        entry.config = neu;
        entry.pool.machineConfigRef.name = neu.metadata.name;

        // Defer removing the old (now-replaced) template until after the cluster
        // save commits the new machineConfigRef. Removing it here (before the
        // cluster save) risks leaving the pool pointing at a deleted template if
        // the cluster save then fails. cleanupMachinePoolConfigs handles removal.
        entry.oldConfig = oldConfig;
      }
    } catch (e) {
      throw new Error(formatErrorMessage(context, 'capa.errors.savingMachineConfig', e));
    }

    finalPools.push(entry.pool);
  }
  if (!cluster.spec.rkeConfig) {
    cluster.spec.rkeConfig = {};
  }
  cluster.spec.rkeConfig.machinePools = finalPools;
}

export async function cleanupMachinePoolConfigs(pools: PoolEntry[]): Promise<void> {
  for (const entry of pools) {
    if (entry.remove && entry.config?.remove) {
      try {
        await entry.config.remove();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('capa: failed to remove machine config for removed pool', e);
      }
    }

    if (entry.oldConfig?.remove) {
      try {
        await entry.oldConfig.remove();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('capa: failed to remove replaced machine template', e);
      }
      entry.oldConfig = null;
    }
  }
}

export async function saveInfrastructureCluster(value: ClusterValue, infrastructureCluster: InfrastructureClusterResource | null, context: StoreContext, isEdit = false, initialInfrastructureCluster: InfrastructureClusterResource | null = null): Promise<void> {
  if (!infrastructureCluster) {
    return;
  }

  infrastructureCluster.metadata = infrastructureCluster.metadata || {};
  if (!isEdit) {
    infrastructureCluster.metadata.namespace = value.metadata?.namespace || DEFAULT_WORKSPACE;
    if (!value.metadata?.name) {
      infrastructureCluster.metadata.generateName = `infra-`;
    } else {
      infrastructureCluster.metadata.name = value.metadata.name;
    }
  }
  try {
    if (isEdit) {
      await patchInfrastructureClusterChanges(initialInfrastructureCluster, infrastructureCluster, context);

      return;
    }
    const infraCluster = await saveWithConflictResolution(initialInfrastructureCluster, infrastructureCluster, context);

    if (!value.spec.rkeConfig) {
      value.spec.rkeConfig = {};
    }

    set(value, 'spec.rkeConfig.infrastructureRef', {
      kind:       'AWSCluster',
      name:       infraCluster.metadata.name,
      namespace:  infraCluster.metadata.namespace,
      apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
    });
  } catch (e) {
    throw new Error(formatErrorMessage(context, 'capa.errors.savingInfrastructureCluster', e));
  }
}

export function removeEmptyFields(input: any): any {
  if (Array.isArray(input)) {
    const cleanedArray = input
      .map((item) => removeEmptyFields(item))
      .filter((item) => item !== undefined);

    return cleanedArray.length ? cleanedArray : undefined;
  }

  if (input && typeof input === 'object') {
    const cleanedObject = Object.entries(input as Record<string, unknown>).reduce((acc: Record<string, unknown>, [key, val]) => {
      const cleanedValue = removeEmptyFields(val);

      if (cleanedValue !== undefined) {
        acc[key] = cleanedValue;
      }

      return acc;
    }, {});

    return Object.keys(cleanedObject).length ? cleanedObject : undefined;
  }

  if (input === undefined || input === null || input === '') {
    return undefined;
  }

  return input;
}

export function isCapaManagedVpcId(vpcId = '', vpcs = [] as AWS.VPC[]) {
  const vpc = vpcs.find((v) => v?.VpcId === vpcId);

  return (vpc?.Tags || [])?.some((tag: { Key?: string }) => (tag.Key || '').startsWith(CAPA.CAPA_CLUSTER_PREFIX));
}

