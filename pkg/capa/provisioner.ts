import { IClusterProvisioner, ClusterProvisionerContext } from '@shell/core/types';
import { mapDriver } from '@shell/store/plugins';
import {
  createMachinePoolMachineConfig, initInfrastructureCluster, saveMachinePoolConfigs, saveInfrastructureCluster, prepareProvCluster, provisioningClusterValidation
} from './utils';
import { AWS_CLUSTER_SCHEMA, AWS_MACHINE_TEMPLATE_SCHEMA, InfrastructureClusterResource } from './types/capa';
import ClusterConfiguration from './components/ClusterConfiguration.vue';
import { isProviderEnabled } from '@shell/utils/settings';

export class CAPAProvisioner implements IClusterProvisioner {
  static ID = 'awsmachinetemplate';

  constructor(private context: ClusterProvisionerContext) {
    mapDriver(this.id, 'aws');
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

  get saveInfrastructureCluster(): (value: any, infrastructureCluster: any, isEdit: boolean) => Promise<void> {
    return async(value, infrastructureCluster, isEdit) => await saveInfrastructureCluster(value, infrastructureCluster, this.context, isEdit);
  }

  get initInfrastructureCluster(): (value: any) => Promise<InfrastructureClusterResource | {} | undefined> {
    const clusterSchemaType = this.clusterSchema?.id || AWS_CLUSTER_SCHEMA;

    return async(value) => await initInfrastructureCluster(value, clusterSchemaType, this.context);
  }

  get prepareProvCluster(): (cluster: any) => Promise<void> {
    return async(cluster) => await prepareProvCluster(cluster, this.context);
  }

  get provisioningClusterValidation(): (cluster: any) => Promise<void> {
    return async(cluster) => await provisioningClusterValidation(cluster, this.context);
  }

  get icon(): any {
    return require('./assets/amazonecapa.svg');
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
    return !isProviderEnabled(this.context, 'aws');
  }

  get extensionInfrastructureSection(): any {
    return ClusterConfiguration;
  }

  get detailTabs(): any {
    return {
      machines:     false,
      logs:         false,
      registration: false,
      snapshots:    false,
      related:      true,
      events:       false,
      conditions:   false,
    };
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
    const runProvisioningClusterValidation = this.provisioningClusterValidation;

    registerBeforeHook(async function(this: any) {
      return runProvisioningClusterValidation(this.value);
    }, 'validate-prov-cluster', 2);
    registerBeforeHook(async function(this: any) {
      return runSaveInfrastructureCluster(this.value, this.infrastructureCluster, this.isEdit);
    }, 'save-infrastructure-cluster', 3);
  }

  registerInitHooks(registerInitHook: (fn: () => Promise<void>, name: string) => void, cluster: any): void {
    const runInitInfrastructureCluster = this.initInfrastructureCluster;
    const runPrepareProvCluster = this.prepareProvCluster;

    registerInitHook(async function(this: any) {
      this.infrastructureCluster = await runInitInfrastructureCluster(this.value);
    }, 'init-infrastructure-cluster-for-capi');

    registerInitHook(() => {
      return runPrepareProvCluster(cluster);
    }, 'prepare-prov-cluster-for-capi');
  }
}
