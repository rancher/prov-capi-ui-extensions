import { CAPI } from '@shell/config/types';
import { ClusterProvisionerContext } from '@shell/core/types';
import { CAPAProvisioner, PROVIDER, detailTabs } from '../provisioner';
import InfrastructureClusterConfiguration from '../components/InfrastructureClusterConfiguration.vue';
import ProvisioningClusterConfiguration from '../components/ProvisioningClusterConfiguration.vue';
import { AWS_CLUSTER_SCHEMA, AWS_MACHINE_TEMPLATE_SCHEMA } from '../types/capa';
import * as utils from '../utils';

jest.mock('../utils', () => ({
  createMachinePoolMachineConfig: jest.fn(),
  initInfrastructureCluster:      jest.fn(),
  saveMachinePoolConfigs:         jest.fn(),
  saveInfrastructureCluster:      jest.fn(),
}));

const createContext = ({ providers = [] as any[], schemas = {} as Record<string, any> } = {}) => {
  return {
    dispatch: jest.fn((action: string, payload: any) => {
      if (action === 'management/clone') {
        return Promise.resolve({ ...payload.resource, cloned: true });
      }

      return Promise.resolve();
    }),
    getters: {
      'management/all':       jest.fn(() => providers),
      'management/schemaFor': jest.fn((type: string) => schemas[type]),
    },
    t: jest.fn((key: string) => `%${ key }%`),
  } as unknown as ClusterProvisionerContext & { dispatch: jest.Mock, t: jest.Mock };
};

describe('class: CAPAProvisioner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should map the provisioner to the aws driver and load CAPI providers when constructed', () => {
    const context = createContext();

    // eslint-disable-next-line no-new
    new CAPAProvisioner(context);

    expect(context.dispatch).toHaveBeenCalledWith('plugins/mapDriver', { name: PROVIDER, to: 'aws' }, { root: true });
    expect(context.dispatch).toHaveBeenCalledWith('management/findAll', { type: CAPI.CAPI_PROVIDER }, { root: true });
  });

  it('should expose its static metadata', () => {
    const provisioner = new CAPAProvisioner(createContext());

    expect(CAPAProvisioner.ID).toBe('awsmachinetemplate');
    expect(provisioner.id).toBe(PROVIDER);
    expect(provisioner.group).toBe('capi');
    expect(provisioner.showImport).toBe(false);
    expect(provisioner.isUpstreamCAPIProvider).toBe(true);
    expect(provisioner.detailTabs).toBe(detailTabs);
    expect(provisioner.icon).toBeDefined();
    expect(provisioner.extensionInfrastructureSection).toBe(InfrastructureClusterConfiguration);
    expect(provisioner.extensionProvisioningSection).toBe(ProvisioningClusterConfiguration);
  });

  it('should hide the events, registration and autoscaler detail tabs', () => {
    expect(detailTabs).toStrictEqual({
      machines:     true,
      logs:         true,
      related:      true,
      conditions:   true,
      snapshots:    true,
      registration: false,
      autoscaler:   false,
      events:       false,
    });
  });

  it('should translate its label and description', () => {
    const context = createContext();
    const provisioner = new CAPAProvisioner(context);

    expect(provisioner.label).toBe('%capa.label%');
    expect(provisioner.description).toBe('%capa.description%');
  });

  it.each([
    ['there are no CAPI providers', [], true],
    ['the aws provider is missing', [{ metadata: { name: 'azure' } }], true],
    ['a provider has no metadata', [{}], true],
    ['the aws provider is installed', [{ metadata: { name: 'cluster-api' } }, { metadata: { name: 'aws' } }], false],
  ])('should set hidden when %s', (_, providers, hidden) => {
    const context = createContext({ providers });
    const provisioner = new CAPAProvisioner(context);

    expect(provisioner.hidden).toBe(hidden);
    expect(context.getters['management/all']).toHaveBeenCalledWith(CAPI.CAPI_PROVIDER);
  });

  it('should be hidden when the providers getter returns nothing', () => {
    const context = createContext();

    (context.getters['management/all'] as jest.Mock).mockReturnValue(undefined);

    expect(new CAPAProvisioner(context).hidden).toBe(true);
  });

  it('should look up the machine template and cluster schemas', () => {
    const machineSchema = { id: AWS_MACHINE_TEMPLATE_SCHEMA };
    const clusterSchema = { id: AWS_CLUSTER_SCHEMA };
    const context = createContext({ schemas: { [AWS_MACHINE_TEMPLATE_SCHEMA]: machineSchema, [AWS_CLUSTER_SCHEMA]: clusterSchema } });
    const provisioner = new CAPAProvisioner(context);

    expect(provisioner.machineConfigSchema).toBe(machineSchema);
    expect(provisioner.clusterSchema).toBe(clusterSchema);
    expect(context.getters['management/schemaFor']).toHaveBeenCalledWith(AWS_MACHINE_TEMPLATE_SCHEMA, true, false);
    expect(context.getters['management/schemaFor']).toHaveBeenCalledWith(AWS_CLUSTER_SCHEMA, true, false);
  });

  it('should map the infrastructure section props', () => {
    const provisioner = new CAPAProvisioner(createContext());
    const infrastructureCluster = { spec: {} };
    const provisioningCluster = { spec: {} };

    expect(provisioner.extensionInfrastructureSectionProps({
      infrastructureCluster, mode: 'edit', credentialId: 'cattle-global-data:cc-1', provisioningCluster
    })).toStrictEqual({
      value: infrastructureCluster, mode: 'edit', credentialId: 'cattle-global-data:cc-1', provisioningCluster
    });
  });

  describe('delegation to utils', () => {
    it('should create machine pool configs using the machine template schema', async() => {
      const machineSchema = { id: AWS_MACHINE_TEMPLATE_SCHEMA };
      const context = createContext({ schemas: { [AWS_MACHINE_TEMPLATE_SCHEMA]: machineSchema } });
      const provisioner = new CAPAProvisioner(context);

      (utils.createMachinePoolMachineConfig as jest.Mock).mockResolvedValue({ created: true });

      expect(await provisioner.createMachinePoolMachineConfig()).toStrictEqual({ created: true });
      expect(utils.createMachinePoolMachineConfig).toHaveBeenCalledWith(machineSchema, context);
    });

    it('should save machine pools', async() => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const pools = [{ pool: {} }];
      const cluster = { spec: {} };

      await provisioner.saveMachinePoolConfigs(pools, cluster);

      expect(utils.saveMachinePoolConfigs).toHaveBeenCalledWith(pools, cluster, context);
    });

    // the provisioner must still provide cleanupMachinePools, otherwise the dashboard deletes removed pools'
    // machine configs itself; templates are labelled for Rancher's cleanup in saveMachinePoolConfigs instead
    it('should not clean up machine pools itself', async() => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const config = { remove: jest.fn(), patch: jest.fn() };
      const pools = [{
        remove: true, pool: { name: 'p' }, config
      }];
      const snapshot = JSON.parse(JSON.stringify(pools));

      context.dispatch.mockClear();

      await expect(provisioner.cleanupMachinePools(pools)).resolves.toBeUndefined();

      expect(config.remove).not.toHaveBeenCalled();
      expect(config.patch).not.toHaveBeenCalled();
      expect(pools).toStrictEqual(snapshot.map((p: any) => ({ ...p, config })));
      expect(context.dispatch).not.toHaveBeenCalled();
      [utils.createMachinePoolMachineConfig, utils.initInfrastructureCluster, utils.saveMachinePoolConfigs, utils.saveInfrastructureCluster].forEach((fn) => {
        expect(fn).not.toHaveBeenCalled();
      });
    });

    it('should save the infrastructure cluster', async() => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const value = { spec: {} };
      const infra = { spec: { region: 'a' } };
      const initial = { spec: {} };

      await provisioner.saveInfrastructureCluster(value, infra, true, initial);

      expect(utils.saveInfrastructureCluster).toHaveBeenCalledWith(value, infra, context, true, initial);
    });

    it.each([
      ['the cluster schema id', { [AWS_CLUSTER_SCHEMA]: { id: 'schema.from.store' } }, 'schema.from.store'],
      ['the default AWSCluster type when the schema is missing', {}, AWS_CLUSTER_SCHEMA],
    ])('should init the infrastructure cluster using %s', async(_, schemas, expectedType) => {
      const context = createContext({ schemas });
      const provisioner = new CAPAProvisioner(context);
      const value = { spec: {} };

      await provisioner.initInfrastructureCluster(value);

      expect(utils.initInfrastructureCluster).toHaveBeenCalledWith(value, expectedType, context);
    });
  });

  describe('hooks', () => {
    it('should register a before-save hook that saves the infrastructure cluster from the component state', async() => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const registerBeforeHook = jest.fn();

      provisioner.registerSaveHooks(registerBeforeHook);

      expect(registerBeforeHook).toHaveBeenCalledWith(expect.any(Function), 'save-infrastructure-cluster', 3);

      const component = {
        value: { spec: {} }, infrastructureCluster: { spec: {} }, isEdit: true, infrastructureClusterInitialValue: { spec: { old: true } }
      };

      await registerBeforeHook.mock.calls[0][0].call(component);

      expect(utils.saveInfrastructureCluster).toHaveBeenCalledWith(component.value, component.infrastructureCluster, context, true, component.infrastructureClusterInitialValue);
    });

    it('should register an init hook that loads the infrastructure cluster and snapshots it', async() => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const registerInitHook = jest.fn();
      const cluster = { metadata: { name: 'c' }, spec: {} };
      const loaded = { spec: { region: 'us-west-2' }, toJSON: () => ({}) };

      (utils.initInfrastructureCluster as jest.Mock).mockResolvedValue(loaded);
      provisioner.registerInitHooks(registerInitHook, cluster);

      expect(registerInitHook).toHaveBeenCalledWith(expect.any(Function), 'init-infrastructure-cluster-for-capi');

      const component: Record<string, any> = {};

      await registerInitHook.mock.calls[0][0].call(component);

      expect(utils.initInfrastructureCluster).toHaveBeenCalledWith(cluster, AWS_CLUSTER_SCHEMA, context);
      expect(component.infrastructureCluster).toBe(loaded);
      expect(context.dispatch).toHaveBeenCalledWith('management/clone', { resource: loaded });
      expect(component.infrastructureClusterInitialValue).toStrictEqual({ ...loaded, cloned: true });
    });

    it.each([
      ['a plain object', { spec: {} }],
      ['nothing', undefined],
    ])('should not snapshot %s', async(_, loaded) => {
      const context = createContext();
      const provisioner = new CAPAProvisioner(context);
      const registerInitHook = jest.fn();

      (utils.initInfrastructureCluster as jest.Mock).mockResolvedValue(loaded);
      provisioner.registerInitHooks(registerInitHook, {});

      const component: Record<string, any> = {};

      await registerInitHook.mock.calls[0][0].call(component);

      expect(component.infrastructureCluster).toBe(loaded);
      expect(component.infrastructureClusterInitialValue).toBeNull();
      expect(context.dispatch).not.toHaveBeenCalledWith('management/clone', expect.anything());
    });
  });
});
