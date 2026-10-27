import { IClusterProvisioner, ClusterProvisionerContext } from '@shell/core/types';
import {
  createMachinePoolMachineConfig, initInfrastructureCluster, saveMachinePoolConfigs, cleanupMachinePoolConfigs, saveInfrastructureCluster
} from './utils';
import {
  AWS_CLUSTER_KIND, AWS_CLUSTER_SCHEMA, AWS_MACHINE_TEMPLATE_KIND, AWS_MACHINE_TEMPLATE_SCHEMA, InfrastructureClusterResource
} from './types/capa';
import { CAPI } from '@shell/config/types';
import InfrastructureClusterConfiguration from './components/InfrastructureClusterConfiguration.vue';
import ProvisioningClusterConfiguration from './components/ProvisioningClusterConfiguration.vue';

export const detailTabs = {
  machines:     true,
  logs:         true,
  related:      true,
  conditions:   true,
  snapshots:    true,
  registration: false,
  autoscaler:   false,
  events:       false,
};

export const PROVIDER = 'awsmachinetemplate';

/**
 * Does this provisioning cluster reference CAPA infrastructure?
 *
 * This only reads the cluster's own spec, so unlike `machineProvider` (which resolves through the
 * management cluster's `status.info`) it is answerable as soon as the provisioning cluster itself
 * is loaded, and for a cluster that hasn't finished provisioning
 *
 * A CAPA cluster's `infrastructureRef` points at an AWSCluster, and its machine pools reference
 * AWSMachineTemplates
 */
export function hasCAPAInfrastructure(cluster: any): boolean {
  const rkeConfig = cluster?.spec?.rkeConfig;

  const isCAPAKind = (ref: any, kind: string) => ref?.kind?.toLowerCase() === kind;

  if (isCAPAKind(rkeConfig?.infrastructureRef, AWS_CLUSTER_KIND)) {
    return true;
  }

  return (rkeConfig?.machinePools || []).some((pool: any) => isCAPAKind(pool?.machineConfigRef, AWS_MACHINE_TEMPLATE_KIND));
}

export class CAPAProvisioner implements IClusterProvisioner {
  static ID = PROVIDER;

  constructor(private context: ClusterProvisionerContext) {
    context.dispatch('plugins/mapDriver', { name: this.id, to: 'aws' }, { root: true });
    // ensure capi providers are loaded so the hidden getter works (controlling the option in the cluster creation type selection screen)
    context.dispatch('management/findAll', { type: CAPI.CAPI_PROVIDER }, { root: true }).catch(() => {});
  }

  get id(): string {
    return CAPAProvisioner.ID;
  }

  get machineConfigSchema(): { [key: string]: any } {
    return this.context.getters['management/schemaFor'](AWS_MACHINE_TEMPLATE_SCHEMA, true, false);
  }

  get clusterSchema(): { [key: string]: any } {
    return this.context.getters['management/schemaFor'](AWS_CLUSTER_SCHEMA, true, false);
  }

  get createMachinePoolMachineConfig(): () => Promise<{[key: string]: any}> {
    return async() => await createMachinePoolMachineConfig(this.machineConfigSchema, this.context);
  }

  get saveMachinePoolConfigs(): (pools: any[], cluster: any) => Promise<void> {
    return async(pools: any[], cluster: any) => await saveMachinePoolConfigs(pools, cluster, this.context);
  }

  get cleanupMachinePools(): (pools: any[]) => Promise<void> {
    return async(pools: any[]) => await cleanupMachinePoolConfigs(pools);
  }

  get saveInfrastructureCluster(): (value: any, infrastructureCluster: any, isEdit: boolean, initialInfrastructureCluster?: any) => Promise<void> {
    return async(value, infrastructureCluster, isEdit, initialInfrastructureCluster) => await saveInfrastructureCluster(value, infrastructureCluster, this.context, isEdit, initialInfrastructureCluster);
  }

  get initInfrastructureCluster(): (value: any) => Promise<InfrastructureClusterResource | {} | undefined> {
    const clusterSchemaType = this.clusterSchema?.id || AWS_CLUSTER_SCHEMA;

    return async(value) => await initInfrastructureCluster(value, clusterSchemaType, this.context);
  }

  get icon(): any {
    return require('./assets/amazoncapa.svg');
  }

  get group(): string {
    return 'capi';
  }

  get label(): string {
    return this.context.t('capa.label');
  }

  get description(): string {
    return this.context.t('capa.description');
  }

  get hidden(): boolean {
    const providers = this.context.getters['management/all'](CAPI.CAPI_PROVIDER) || [];

    return !providers.some((p: any) => p.metadata?.name === 'aws');
  }

  get extensionInfrastructureSection(): any {
    return InfrastructureClusterConfiguration;
  }

  get extensionInfrastructureSectionProps(): (context: {
    infrastructureCluster?: any;
    mode?: string;
    credentialId?: string;
    provisioningCluster?: any;
  }) => Record<string, any> {
    return ({
      infrastructureCluster,
      mode,
      credentialId,
      provisioningCluster
    }) => ({
      value: infrastructureCluster,
      mode,
      credentialId,
      provisioningCluster,
    });
  }

  get extensionProvisioningSection(): any {
    return ProvisioningClusterConfiguration;
  }

  get extensionProvisioningSectionProps(): (context: {
    mode?: string;
    provisioningCluster?: any;
  }) => Record<string, any> {
    return ({
      mode,
      provisioningCluster
    }) => ({
      value: provisioningCluster,
      mode,
    });
  }

  get detailTabs(): any {
    return detailTabs;
  }

  get showImport(): boolean {
    return false;
  }

  get isUpstreamCAPIProvider(): boolean {
    return true;
  }

  registerSaveHooks(
    registerBeforeHook: (fn: () => Promise<void>, name: string, priority?: number) => void,
  ): void {
    const runSaveInfrastructureCluster = this.saveInfrastructureCluster;

    registerBeforeHook(async function(this: any) {
      return runSaveInfrastructureCluster(this.value, this.infrastructureCluster, this.isEdit, this.infrastructureClusterInitialValue);
    }, 'save-infrastructure-cluster', 3);
  }

  registerInitHooks(registerInitHook: (fn: () => Promise<void>, name: string) => void, cluster: any): void {
    const runInitInfrastructureCluster = this.initInfrastructureCluster;
    const context = this.context;

    registerInitHook(async function(this: any) {
      this.infrastructureCluster = await runInitInfrastructureCluster(cluster);

      // Snapshot the freshly-loaded infra cluster so save() can do a 3-way merge
      // on conflict, mirroring how the core create-edit-view tracks initialValue.
      const loaded = this.infrastructureCluster;

      this.infrastructureClusterInitialValue = loaded && typeof loaded.toJSON === 'function' ? await context.dispatch('management/clone', { resource: loaded }) : null;
    }, 'init-infrastructure-cluster-for-capi');
  }
}
