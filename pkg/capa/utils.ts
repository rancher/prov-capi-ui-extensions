import { normalizeName } from '@shell/utils/kube';
import { DEFAULT_WORKSPACE } from '@shell/config/types';
import {
  AWS_MACHINE_TEMPLATE_SCHEMA, InfrastructureClusterResource, ClusterValue, MachineConfigSchema, MachinePool, PoolEntry, StoreContext
} from './types/capa';
import { set } from '@shell/utils/object';
import { createDoNotLogError } from '@shell/utils/error';

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
      - --cloud-provider=aws`;

function formatErrorMessage(context: StoreContext, key: string, e?: any): string {
  const error = e instanceof Error || e?.message ? e.message : e !== undefined ? String(e) : undefined;
  const t = context.t || context.$t;

  return t ? t(key, { error }) : error ? `${ key }: ${ error }` : key;
}
export async function prepareProvCluster(cluster: any, context: StoreContext): Promise<void> {
  if (!cluster?.spec?.rkeConfig?.additionalManifest) {
    set(cluster, 'spec.rkeConfig.additionalManifest', ADDITIONAL_MANIFEST);
  }

  if (cluster?.agentConfig?.['cloud-provider-name'] !== 'external') {
    set(cluster, 'agentConfig.cloud-provider-name', 'external');
  }
}

export function provisioningClusterValidation(cluster: any, context: StoreContext): void {
  if (!cluster?.spec?.rkeConfig?.additionalManifest) {
    throw createDoNotLogError(formatErrorMessage(context, 'capa.errors.missingAdditionalManifest'));
  }

  if (cluster.agentConfig?.['cloud-provider-name'] !== 'external') {
    throw createDoNotLogError(formatErrorMessage(context, 'capa.errors.invalidCloudProviderName'));
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
        config = await context.dispatch('management/createPopulated', {
          type:     clusterSchema,
          metadata: { namespace: DEFAULT_WORKSPACE }
        }) as InfrastructureClusterResource;
      } catch (e) {
        throw new Error(formatErrorMessage(context, 'capa.errors.creatingInfrastructureClusterConfig', e));
      }
    }
    if (config) {
      config.spec = removeEmptyFields(config.spec);
    }

    // TODO handle case where config is still missing and make sure spec is setup correctly
    return config || {};
  }
}

export async function createMachinePoolMachineConfig(machineConfigSchema: MachineConfigSchema | undefined, context: StoreContext): Promise<InfrastructureClusterResource | Record<string, never>> {
  const machineConfigType = machineConfigSchema?.id || AWS_MACHINE_TEMPLATE_SCHEMA;

  await context.dispatch('management/waitForSchema', { type: machineConfigType });

  const createConfig = await context.dispatch('management/createPopulated', {
    type:     machineConfigType,
    metadata: { namespace: DEFAULT_WORKSPACE }
  }) as InfrastructureClusterResource | undefined;

  const config = createConfig || {};

  // TODO apply some defaults
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
        const oldConfig = entry.config;

        // Clone before mutating so oldConfig retains its identity (links/id) for removal.
        const newConfig = await context.dispatch('management/clone', { resource: oldConfig }) as InfrastructureClusterResource;

        delete newConfig.id;
        delete newConfig.metadata.name;
        delete newConfig.metadata.resourceVersion;
        delete newConfig.metadata.uid;
        delete newConfig.links;
        newConfig.metadata.generateName = `nc-${ prefixFormatted }-`;

        const neu = await newConfig.save();

        entry.config = neu;
        entry.pool.machineConfigRef.name = neu.metadata.name;

        try {
          if (oldConfig.remove) {
            await oldConfig.remove();
          }
        } catch (e) {
          throw new Error(formatErrorMessage(context, 'capa.errors.removingOldMachineConfig', e));
        }
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

export async function saveInfrastructureCluster(value: ClusterValue, infrastructureCluster: InfrastructureClusterResource | null, context: StoreContext, isEdit = false): Promise<void> {
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
    const infraCluster = await infrastructureCluster.save();

    if (!isEdit) {
      if (!value.spec.rkeConfig) {
        value.spec.rkeConfig = {};
      }

      set(value, 'spec.rkeConfig.infrastructureRef', {
        kind:       'AWSCluster',
        name:       infraCluster.metadata.name,
        namespace:  infraCluster.metadata.namespace,
        apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
      });
    }
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
