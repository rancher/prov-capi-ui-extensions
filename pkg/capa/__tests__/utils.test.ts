import { DEFAULT_WORKSPACE } from '@shell/config/types';
import { isDoNotLogError } from '@shell/utils/error';
import type { VPC } from '@shell/types/aws-sdk';
import {
  prepareProvCluster,
  provisioningClusterValidation,
  initInfrastructureCluster,
  createMachinePoolMachineConfig,
  saveMachinePoolConfigs,
  saveInfrastructureCluster,
  removeEmptyFields,
  isCapaManagedVpcId,
  dedupeIngressRules,
  dedupeInfrastructureClusterIngressRules,
} from '../utils';
import { PROVISIONING } from '../labels-annotations';
import {
  AWS_CLUSTER_SCHEMA, AWS_MACHINE_TEMPLATE_SCHEMA, ClusterValue, PoolEntry, StoreContext
} from '../types/capa';

type Handler = (payload: any) => any;

/**
 * A fake provisioner/store context. `dispatch` routes to the per-action handlers passed in; the
 * `cleanForDiff` and `clone` actions default to identity / a shallow copy, which is enough for the
 * diffing done in utils.ts.
 */
const createContext = (handlers: Record<string, Handler> = {}, extra: Partial<StoreContext> = {}): StoreContext & { dispatch: jest.Mock } => {
  const dispatch = jest.fn(async(action: string, payload: any) => {
    if (handlers[action]) {
      return handlers[action](payload);
    }

    if (action === 'management/cleanForDiff') {
      return JSON.parse(JSON.stringify(payload));
    }

    if (action === 'management/clone') {
      return cloneResource(payload.resource);
    }

    return undefined;
  });

  return {
    dispatch,
    getters: {
      'management/canList': () => true,
      'i18n/t':             (key: string) => key,
    },
    t: (key: string, args?: Record<string, any>) => `${ key }:${ args?.error }`,
    ...extra,
  } as unknown as StoreContext & { dispatch: jest.Mock };
};

const CLEANUP_LABEL = PROVISIONING.INFRA_CLEANUP_ENABLED;
const CLEANUP_PATCH = [{ metadata: { labels: { [CLEANUP_LABEL]: 'true' } } }, { headers: { 'content-type': 'application/merge-patch+json' } }];

/**
 * A minimal stand-in for a steve resource model: plain data plus save/remove/toJSON. `patchable` adds a
 * `patch` mock, as on real models; it is left off by default because its presence changes the edit-mode
 * save path of the AWSCluster.
 */
const createResource = (data: Record<string, any>, { saved, saveImpl, patchable }: { saved?: Record<string, any>, saveImpl?: jest.Mock, patchable?: boolean } = {}): any => {
  const resource: any = {
    ...JSON.parse(JSON.stringify(data)),
    save:   saveImpl || jest.fn(async() => saved ?? resource),
    remove: jest.fn(async() => undefined),
  };

  if (patchable) {
    resource.patch = jest.fn(async() => resource);
  }

  Object.defineProperty(resource, 'toJSON', {
    enumerable: false,
    value:      () => {
      const {
        save, remove, patch, ...rest
      } = resource;

      return JSON.parse(JSON.stringify(rest));
    }
  });

  return resource;
};

const cloneResource = (resource: any) => createResource(resource.toJSON ? resource.toJSON() : resource);

const RKE2_SELECTOR_KEYS = ['rke.cattle.io/control-plane-role', 'rke.cattle.io/etcd-role'];
const K3S_SELECTOR_KEYS = ['rke.cattle.io/control-plane-role', 'rke.cattle.io/etcd-role', 'rke.cattle.io/worker-role'];
const selectorKeys = (cluster: any) => cluster.spec.rkeConfig.machineSelectorConfig.map((c: any) => c.machineLabelSelector.matchExpressions[0].key);

describe('utils', () => {
  describe('fx: prepareProvCluster', () => {
    it('should add the aws cloud controller manifest, external cloud provider and rke2 selector config to an empty cluster', async() => {
      const cluster: any = { spec: { kubernetesVersion: 'v1.32.1+rke2r1' } };

      await prepareProvCluster(cluster);

      expect(cluster.spec.rkeConfig.additionalManifest).toContain('name: aws-cloud-controller-manager');
      expect(cluster.spec.rkeConfig.additionalManifest).toContain('--cloud-provider=aws');
      expect(cluster.agentConfig['cloud-provider-name']).toBe('external');
      expect(selectorKeys(cluster)).toStrictEqual(RKE2_SELECTOR_KEYS);
      cluster.spec.rkeConfig.machineSelectorConfig.forEach((c: any) => {
        expect(c.config).toStrictEqual({ 'disable-cloud-controller': 'true' });
      });
    });

    it('should use the k3s selector config for k3s versions', async() => {
      const cluster: any = { spec: { kubernetesVersion: 'v1.32.1+k3s1' } };

      await prepareProvCluster(cluster);

      expect(selectorKeys(cluster)).toStrictEqual(K3S_SELECTOR_KEYS);
      expect(cluster.spec.rkeConfig.machineSelectorConfig[0].config).toStrictEqual({
        'disable-cloud-controller':    'true',
        'kube-controller-manager-arg': ['cloud-provider=external'],
        'kubelet-arg':                 ['cloud-provider=external'],
      });
      expect(cluster.spec.rkeConfig.machineSelectorConfig[2].config).toStrictEqual({ 'kubelet-arg': ['cloud-provider=external'] });
    });

    it('should default to the rke2 config when there is no kubernetes version', async() => {
      const cluster: any = { spec: {} };

      await prepareProvCluster(cluster);

      expect(selectorKeys(cluster)).toStrictEqual(RKE2_SELECTOR_KEYS);
    });

    it('should not overwrite a user-provided additional manifest', async() => {
      const cluster: any = { spec: { rkeConfig: { additionalManifest: 'kind: Custom' } } };

      await prepareProvCluster(cluster);

      expect(cluster.spec.rkeConfig.additionalManifest).toBe('kind: Custom');
    });

    it('should override a non-external cloud provider name', async() => {
      const cluster: any = { spec: {}, agentConfig: { 'cloud-provider-name': 'aws', other: 'kept' } };

      await prepareProvCluster(cluster);

      expect(cluster.agentConfig).toStrictEqual({ 'cloud-provider-name': 'external', other: 'kept' });
    });

    it('should append the required selector config to existing user entries', async() => {
      const userEntry = { config: { 'protect-kernel-defaults': true } };
      const cluster: any = { spec: { rkeConfig: { machineSelectorConfig: [userEntry] } } };

      await prepareProvCluster(cluster);

      expect(cluster.spec.rkeConfig.machineSelectorConfig).toHaveLength(3);
      expect(cluster.spec.rkeConfig.machineSelectorConfig[0]).toStrictEqual(userEntry);
    });

    // prepareProvCluster assigns the module-level MACHINE_SELECTOR_CONFIG_* array itself (not a copy) to the
    // cluster, so any in-place edit of the cluster's machineSelectorConfig (e.g. push/splice) also mutates
    // the shared constant, and with it the requirement checked by provisioningClusterValidation for every
    // subsequent cluster in the session.
    it.todo('should not share the default machine selector config array with the cluster');

    it('should be idempotent', async() => {
      const cluster: any = { spec: { kubernetesVersion: 'v1.32.1+k3s1' } };

      await prepareProvCluster(cluster);
      const once = JSON.parse(JSON.stringify(cluster));

      await prepareProvCluster(cluster);

      expect(cluster).toStrictEqual(once);
    });
  });

  describe('fx: provisioningClusterValidation', () => {
    it.each([
      ['v1.32.1+rke2r1'],
      ['v1.32.1+k3s1'],
    ])('should pass for a %p cluster prepared by prepareProvCluster', async(kubernetesVersion) => {
      const cluster: any = { spec: { kubernetesVersion } };

      await prepareProvCluster(cluster);

      expect(() => provisioningClusterValidation(cluster)).not.toThrow();
    });

    it.each([
      [
        'there is no additional manifest',
        (c: any) => delete c.spec.rkeConfig.additionalManifest,
        'capa.errors.missingAdditionalManifest'
      ],
      [
        'the cloud provider is not external',
        (c: any) => (c.agentConfig['cloud-provider-name'] = 'aws'),
        'capa.errors.invalidCloudProviderName'
      ],
      [
        'the machine selector config is missing',
        (c: any) => delete c.spec.rkeConfig.machineSelectorConfig,
        'capa.errors.missingMachineSelectorConfig'
      ],
      [
        'one of the required selector entries is missing',
        (c: any) => (c.spec.rkeConfig.machineSelectorConfig = c.spec.rkeConfig.machineSelectorConfig.slice(1)),
        'capa.errors.missingMachineSelectorConfig'
      ],
      [
        'the rke2 selector config is used for a k3s cluster',
        (c: any) => (c.spec.kubernetesVersion = 'v1.32.1+k3s1'),
        'capa.errors.missingMachineSelectorConfig'
      ],
    ])('should throw a do-not-log error when %s', async(_, breakIt, message) => {
      const cluster: any = { spec: { kubernetesVersion: 'v1.32.1+rke2r1' } };

      await prepareProvCluster(cluster);
      breakIt(cluster);

      let error: any;

      try {
        provisioningClusterValidation(cluster);
      } catch (e) {
        error = e;
      }

      expect(error?.message).toBe(message);
      expect(isDoNotLogError(error)).toBe(true);
    });
  });

  describe('fx: initInfrastructureCluster', () => {
    it('should skip creation and warn when there is no cluster schema', async() => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const context = createContext();

      const res = await initInfrastructureCluster({ spec: {} }, '', context);

      expect(res).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(context.dispatch).not.toHaveBeenCalled();
    });

    it('should do nothing when the user cannot list the cluster schema', async() => {
      const context = createContext({}, { getters: { 'management/canList': () => false } } as any);

      const res = await initInfrastructureCluster({ spec: {} }, AWS_CLUSTER_SCHEMA, context);

      expect(res).toBeUndefined();
      expect(context.dispatch).not.toHaveBeenCalled();
    });

    it('should create a new AWSCluster in the default workspace for a new cluster', async() => {
      const created = createResource({ metadata: { namespace: DEFAULT_WORKSPACE }, spec: { region: '', network: {} } });
      const context = createContext({ 'management/create': () => created });

      const res: any = await initInfrastructureCluster({ spec: {} }, AWS_CLUSTER_SCHEMA, context);

      expect(context.dispatch).toHaveBeenCalledWith('management/create', { type: AWS_CLUSTER_SCHEMA, metadata: { namespace: DEFAULT_WORKSPACE } });
      // the created model is cloned so edits don't leak into the store copy
      expect(context.dispatch).toHaveBeenCalledWith('management/clone', { resource: created });
      expect(res).not.toBe(created);
      // empty values are stripped from the spec
      expect(res.spec).toStrictEqual({});
    });

    it('should load the AWSCluster referenced by the infrastructureRef when editing', async() => {
      const existing = createResource({
        metadata: { name: 'infra', namespace: 'ns' },
        spec:     {
          region: 'us-west-2', sshKeyName: '', network: { vpc: { id: 'vpc-1' }, subnets: [] }
        }
      });
      const find = jest.fn(() => existing);
      const context = createContext({ 'management/find': find });
      const value: ClusterValue = {
        metadata: { name: 'my-cluster' },
        spec:     { rkeConfig: { infrastructureRef: { name: 'infra', namespace: 'ns' } } }
      };

      const res: any = await initInfrastructureCluster(value, AWS_CLUSTER_SCHEMA, context);

      expect(find).toHaveBeenCalledWith({ type: AWS_CLUSTER_SCHEMA, id: 'ns/infra' });
      expect(context.dispatch).not.toHaveBeenCalledWith('management/create', expect.anything());
      expect(res.spec).toStrictEqual({ region: 'us-west-2', network: { vpc: { id: 'vpc-1' } } });
    });

    it('should fall back to finding the AWSCluster by cluster-name label', async() => {
      const existing = createResource({ metadata: { name: 'infra' }, spec: { region: 'us-east-1' } });
      const find = jest.fn(() => existing);
      const context = createContext({ 'management/find': find });

      await initInfrastructureCluster({ metadata: { name: 'my-cluster' }, spec: {} }, AWS_CLUSTER_SCHEMA, context);

      expect(find).toHaveBeenCalledWith({ type: AWS_CLUSTER_SCHEMA, selector: 'cluster.x-k8s.io/cluster-name=my-cluster' });
    });

    it.each([
      ['returns nothing', () => undefined],
      ['throws', () => {
        throw new Error('404');
      }],
    ])('should create a new AWSCluster when the lookup %s', async(_, find) => {
      const created = createResource({ metadata: {}, spec: {} });
      const context = createContext({ 'management/find': find, 'management/create': () => created });

      await initInfrastructureCluster({ metadata: { name: 'my-cluster' }, spec: {} }, AWS_CLUSTER_SCHEMA, context);

      expect(context.dispatch).toHaveBeenCalledWith('management/create', { type: AWS_CLUSTER_SCHEMA, metadata: { namespace: DEFAULT_WORKSPACE } });
    });

    it('should not clone a plain (non-model) object', async() => {
      const context = createContext({ 'management/create': () => ({ metadata: {}, spec: { region: 'x' } }) });

      const res: any = await initInfrastructureCluster({ spec: {} }, AWS_CLUSTER_SCHEMA, context);

      expect(context.dispatch).not.toHaveBeenCalledWith('management/clone', expect.anything());
      expect(res.spec).toStrictEqual({ region: 'x' });
    });

    it('should return an empty object when creation returns nothing', async() => {
      const context = createContext({ 'management/create': () => undefined });

      expect(await initInfrastructureCluster({ spec: {} }, AWS_CLUSTER_SCHEMA, context)).toStrictEqual({});
    });

    it('should throw a translated error when creation fails', async() => {
      const context = createContext({
        'management/create': () => {
          throw new Error('boom');
        }
      });

      await expect(initInfrastructureCluster({ spec: {} }, AWS_CLUSTER_SCHEMA, context)).rejects.toThrow('capa.errors.creatingInfrastructureClusterConfig:boom');
    });
  });

  describe('fx: createMachinePoolMachineConfig', () => {
    it('should wait for the schema and create a machine template in the default workspace', async() => {
      const created = { metadata: { namespace: DEFAULT_WORKSPACE }, spec: {} };
      const context = createContext({ 'management/create': () => created });

      const res = await createMachinePoolMachineConfig({ id: 'custom.schema' }, context);

      expect(context.dispatch.mock.calls).toStrictEqual([
        ['management/waitForSchema', { type: 'custom.schema' }],
        ['management/create', { type: 'custom.schema', metadata: { namespace: DEFAULT_WORKSPACE } }],
      ]);
      expect(res).toBe(created);
    });

    it('should default to the AWSMachineTemplate schema', async() => {
      const context = createContext();

      await createMachinePoolMachineConfig(undefined, context);

      expect(context.dispatch).toHaveBeenCalledWith('management/waitForSchema', { type: AWS_MACHINE_TEMPLATE_SCHEMA });
      expect(context.dispatch).toHaveBeenCalledWith('management/create', { type: AWS_MACHINE_TEMPLATE_SCHEMA, metadata: { namespace: DEFAULT_WORKSPACE } });
    });

    it('should return an empty object when nothing was created', async() => {
      expect(await createMachinePoolMachineConfig(undefined, createContext())).toStrictEqual({});
    });
  });

  describe('fx: saveMachinePoolConfigs', () => {
    const pool = (name: string, ref?: string) => ({ name, machineConfigRef: { name: ref } });

    it('should save new machine templates with a generated name and point the pool at them', async() => {
      const config = createResource({ metadata: { namespace: DEFAULT_WORKSPACE }, spec: { template: { spec: {} } } }, { saved: { metadata: { name: 'nc-my-cluster-pool1-abcde' } } });
      const entry: PoolEntry = {
        create: true, pool: pool('pool1'), config
      };
      const cluster: ClusterValue = { metadata: { name: 'my-cluster' }, spec: {} };

      await saveMachinePoolConfigs([entry], cluster, createContext());

      expect(config.metadata.generateName).toBe('nc-my-cluster-pool1-');
      expect(config.metadata.labels).toStrictEqual({ [CLEANUP_LABEL]: 'true' });
      expect(config.save).toHaveBeenCalledTimes(1);
      expect(entry.config).toStrictEqual({ metadata: { name: 'nc-my-cluster-pool1-abcde' } });
      expect(entry.create).toBe(false);
      expect(entry.update).toBe(true);
      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual([pool('pool1', 'nc-my-cluster-pool1-abcde')]);
    });

    it.each([
      ['normalises the pool name', 'my-cluster', 'My Pool', 'nc-my-cluster-my-pool-', 'my-pool'],
      ['defaults an empty pool name', 'my-cluster', '', 'nc-my-cluster-pool-', 'pool'],
      ['defaults a missing cluster name', undefined, 'p', 'nc-cluster-p-', 'p'],
      ['lowercases the cluster name', 'MyCluster', 'p', 'nc-mycluster-p-', 'p'],
      ['truncates long names to 50 characters', 'c'.repeat(60), 'p', `nc-${ 'c'.repeat(50) }-`, 'p'],
    ])('should build the generated name: %s', async(_, clusterName, poolName, generateName, normalisedPoolName) => {
      const config = createResource({ metadata: {} }, { saved: { metadata: { name: 'saved' } } });
      const entry: PoolEntry = {
        create: true, pool: pool(poolName), config
      };

      await saveMachinePoolConfigs([entry], { metadata: { name: clusterName }, spec: {} }, createContext());

      expect(config.metadata.generateName).toBe(generateName);
      expect(entry.pool.name).toBe(normalisedPoolName);
    });

    it('should keep an explicit machine template name', async() => {
      const config = createResource({ metadata: { name: 'explicit' } }, { saved: { metadata: { name: 'explicit' } } });

      await saveMachinePoolConfigs([{
        create: true, pool: pool('p'), config
      }], { spec: {} }, createContext());

      expect(config.metadata.generateName).toBeUndefined();
    });

    it('should drop removed pools from the cluster', async() => {
      const keep: PoolEntry = { pool: pool('keep', 'cfg-keep'), config: null };
      const removed: PoolEntry = {
        remove: true, pool: pool('gone', 'cfg-gone'), config: createResource({ metadata: { name: 'cfg-gone' } })
      };
      const cluster: ClusterValue = { spec: { rkeConfig: { machinePools: [] } } };

      await saveMachinePoolConfigs([keep, removed], cluster, createContext());

      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual([pool('keep', 'cfg-keep')]);
      expect(removed.config?.save).not.toHaveBeenCalled();
      expect(removed.config?.remove).not.toHaveBeenCalled();
    });

    it('should leave an unmodified machine template alone', async() => {
      const config = createResource({ metadata: { name: 'cfg', namespace: 'ns' }, spec: { template: { spec: { instanceType: 't3.medium' } } } }, { patchable: true });
      const find = jest.fn(() => createResource(config.toJSON()));
      const context = createContext({ 'management/find': find });
      const entry: PoolEntry = {
        update: true, pool: pool('p', 'cfg'), config
      };
      const cluster: ClusterValue = { spec: {} };

      await saveMachinePoolConfigs([entry], cluster, context);

      expect(find).toHaveBeenCalledWith({
        type: AWS_MACHINE_TEMPLATE_SCHEMA, id: 'ns/cfg', opt: { force: true, watch: false }
      });
      expect(context.dispatch).not.toHaveBeenCalledWith('management/clone', expect.anything());
      expect(config.save).not.toHaveBeenCalled();
      expect(entry.config).toBe(config);
      // a template that is still in use is not labelled for cleanup
      expect(config.patch).not.toHaveBeenCalled();
      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual([pool('p', 'cfg')]);
    });

    it('should look the template up by its id and type when present', async() => {
      const config = createResource({
        id: 'other/cfg', type: 'some.type', metadata: { name: 'cfg' }
      });
      const find = jest.fn(() => createResource(config.toJSON()));

      await saveMachinePoolConfigs([{
        update: true, pool: pool('p', 'cfg'), config
      }], { spec: {} }, createContext({ 'management/find': find }));

      expect(find).toHaveBeenCalledWith({
        type: 'some.type', id: 'other/cfg', opt: { force: true, watch: false }
      });
    });

    it('should replace a modified (immutable) machine template with a new one and label the old one for cleanup', async() => {
      const config = createResource({
        id:       'fleet-default/cfg',
        metadata: {
          name: 'cfg', namespace: 'fleet-default', resourceVersion: '1', uid: 'u1', labels: { team: 'capi' }
        },
        links: { self: 'x' },
        spec:  { template: { spec: { instanceType: 't3.large' } } },
      }, { patchable: true });
      const server = createResource({ ...config.toJSON(), spec: { template: { spec: { instanceType: 't3.medium' } } } });
      const replacement = createResource(config.toJSON(), { saved: { metadata: { name: 'nc-c-p-new' } } });
      const context = createContext({ 'management/find': () => server, 'management/clone': () => replacement });
      const entry: PoolEntry = {
        update: true, pool: pool('p', 'cfg'), config
      };
      const cluster: ClusterValue = { metadata: { name: 'c' }, spec: {} };

      await saveMachinePoolConfigs([entry], cluster, context);

      expect(context.dispatch).toHaveBeenCalledWith('management/clone', { resource: config });
      expect(replacement.id).toBeUndefined();
      expect(replacement.links).toBeUndefined();
      // the cleanup label is merged into the labels copied from the old template
      expect(replacement.metadata).toStrictEqual({
        namespace: 'fleet-default', generateName: 'nc-c-p-', labels: { team: 'capi', [CLEANUP_LABEL]: 'true' }
      });
      expect(replacement.spec).toStrictEqual({ template: { spec: { instanceType: 't3.large' } } });
      expect(replacement.save).toHaveBeenCalledTimes(1);
      // the old template is never deleted by the UI, it is labelled so Rancher cleans it up once unused
      expect(config.patch).toHaveBeenCalledWith(...CLEANUP_PATCH);
      expect(config.metadata.labels).toStrictEqual({ team: 'capi', [CLEANUP_LABEL]: 'true' });
      expect(config.remove).not.toHaveBeenCalled();
      expect(entry.config).toStrictEqual({ metadata: { name: 'nc-c-p-new' } });
      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual([pool('p', 'nc-c-p-new')]);
    });

    it('should treat the template as modified when the comparison fails', async() => {
      const config = createResource({ metadata: { name: 'cfg' } });
      const replacement = createResource(config.toJSON(), { saved: { metadata: { name: 'new' } } });
      const context = createContext({
        'management/find': () => {
          throw new Error('nope');
        },
        'management/clone': () => replacement
      });
      const entry: PoolEntry = {
        update: true, pool: pool('p', 'cfg'), config
      };

      await saveMachinePoolConfigs([entry], { spec: {} }, context);

      expect(replacement.save).toHaveBeenCalledTimes(1);
      expect(entry.pool.machineConfigRef.name).toBe('new');
    });

    it('should keep the pool as-is when an updated pool has no machine template', async() => {
      const entry: PoolEntry = {
        update: true, pool: pool('p', 'cfg'), config: null
      };
      const cluster: ClusterValue = { spec: {} };
      const context = createContext();

      await saveMachinePoolConfigs([entry], cluster, context);

      expect(context.dispatch).not.toHaveBeenCalled();
      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual([pool('p', 'cfg')]);
    });

    it('should throw a translated error when a new pool has no machine template', async() => {
      await expect(saveMachinePoolConfigs([{
        create: true, pool: pool('p'), config: null
      }], { spec: {} }, createContext())).rejects.toThrow('capa.errors.savingMachineConfig:Missing machine config for pool "p"');
    });
  });

  describe('fx: saveMachinePoolConfigs - cleanup labels', () => {
    const pool = (name: string, ref?: string) => ({ name, machineConfigRef: { name: ref } });

    // an existing template whose spec differs from the server copy, so saving replaces it
    const modifiedTemplate = (labels?: Record<string, string>, { patchable = true } = {}) => {
      const config = createResource({
        metadata: {
          name: 'cfg', namespace: 'ns', labels
        },
        spec: { template: { spec: { instanceType: 't3.large' } } }
      }, { patchable });
      const server = createResource({ ...config.toJSON(), spec: { template: { spec: { instanceType: 't3.medium' } } } });
      const replacement = createResource(config.toJSON(), { saved: { metadata: { name: 'new' } } });
      const context = createContext({ 'management/find': () => server, 'management/clone': () => replacement });

      return {
        config,
        replacement,
        context,
        entry: {
          update: true, pool: pool('p', 'cfg'), config
        } as PoolEntry
      };
    };

    it('should merge the cleanup label into the labels of a new machine template', async() => {
      const config = createResource({ metadata: { labels: { team: 'capi' } } }, { saved: { metadata: { name: 'saved' } } });

      await saveMachinePoolConfigs([{
        create: true, pool: pool('p'), config
      }], { spec: {} }, createContext());

      expect(config.metadata.labels).toStrictEqual({ team: 'capi', [CLEANUP_LABEL]: 'true' });
    });

    it('should label the template of a removed pool instead of deleting it', async() => {
      const config = createResource({ metadata: { name: 'gone' } }, { patchable: true });
      const removed: PoolEntry = {
        remove: true, pool: pool('gone', 'gone'), config
      };

      await saveMachinePoolConfigs([removed], { spec: {} }, createContext());

      expect(config.patch).toHaveBeenCalledWith(...CLEANUP_PATCH);
      expect(config.metadata.labels).toStrictEqual({ [CLEANUP_LABEL]: 'true' });
      expect(config.remove).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
    });

    it.each([
      ['a removed pool', true],
      ['a replaced template', false],
    ])('should not patch the template of %s when it is already labelled', async(_, remove) => {
      const { config, context, entry } = modifiedTemplate({ [CLEANUP_LABEL]: 'true' });

      entry.remove = remove;
      await saveMachinePoolConfigs([entry], { spec: {} }, context);

      expect(config.patch).not.toHaveBeenCalled();
    });

    it.each([
      ['"false"', { [CLEANUP_LABEL]: 'false' }],
      ['missing', undefined],
    ])('should patch a template whose cleanup label is %s', async(_, labels) => {
      const { config, context, entry } = modifiedTemplate(labels);

      await saveMachinePoolConfigs([entry], { spec: {} }, context);

      expect(config.patch).toHaveBeenCalledWith(...CLEANUP_PATCH);
    });

    it.each([
      ['a removed pool', true],
      ['a replaced template', false],
    ])('should skip labelling the template of %s when it cannot be patched', async(_, remove) => {
      const { config, context, entry } = modifiedTemplate(undefined, { patchable: false });

      entry.remove = remove;

      await expect(saveMachinePoolConfigs([entry], { spec: {} }, context)).resolves.toBeUndefined();
      expect(config.metadata.labels).toBeUndefined();
    });

    it('should skip a removed pool without a template', async() => {
      await expect(saveMachinePoolConfigs([{
        remove: true, pool: pool('p'), config: null
      }], { spec: {} }, createContext())).resolves.toBeUndefined();
    });

    it.each([
      ['a removed pool', true],
      ['a replaced template', false],
    ])('should only warn when labelling the template of %s fails', async(_, remove) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const {
        config, replacement, context, entry
      } = modifiedTemplate();
      const cluster: ClusterValue = { spec: {} };

      config.patch.mockRejectedValue(new Error('forbidden'));
      entry.remove = remove;

      await saveMachinePoolConfigs([entry], cluster, context);

      expect(warn).toHaveBeenCalledTimes(1);
      // the label is only recorded locally once the patch succeeded
      expect(config.metadata.labels).toBeUndefined();
      expect(cluster.spec.rkeConfig?.machinePools).toStrictEqual(remove ? [] : [pool('p', 'new')]);
      expect(replacement.save).toHaveBeenCalledTimes(remove ? 0 : 1);
    });

    it('should never remove a machine template', async() => {
      const created = createResource({ metadata: {} }, { saved: { metadata: { name: 'created' } }, patchable: true });
      const removedConfig = createResource({ metadata: { name: 'gone' } }, { patchable: true });
      const {
        config, replacement, context, entry
      } = modifiedTemplate();

      await saveMachinePoolConfigs([
        {
          create: true, pool: pool('a'), config: created
        },
        {
          remove: true, pool: pool('b', 'gone'), config: removedConfig
        },
        entry,
      ], { spec: {} }, context);

      [created, removedConfig, config, replacement].forEach((resource) => {
        expect(resource.remove).not.toHaveBeenCalled();
      });
    });
  });

  describe('fx: saveInfrastructureCluster', () => {
    it('should do nothing without an infrastructure cluster', async() => {
      const context = createContext();
      const value: ClusterValue = { spec: {} };

      await saveInfrastructureCluster(value, null, context);

      expect(value).toStrictEqual({ spec: {} });
      expect(context.dispatch).not.toHaveBeenCalled();
    });

    it('should save a new AWSCluster named after the cluster and reference it from the rke config', async() => {
      const infra = createResource({ spec: { region: 'us-west-2' } }, { saved: { metadata: { name: 'my-cluster', namespace: 'ns' } } });
      const value: ClusterValue = { metadata: { name: 'my-cluster', namespace: 'ns' }, spec: {} };

      await saveInfrastructureCluster(value, infra, createContext());

      expect(infra.metadata).toStrictEqual({
        namespace: 'ns', name: 'my-cluster', labels: { [CLEANUP_LABEL]: 'true' }
      });
      expect(infra.save).toHaveBeenCalledTimes(1);
      expect(value.spec.rkeConfig?.infrastructureRef).toStrictEqual({
        kind:       'AWSCluster',
        name:       'my-cluster',
        namespace:  'ns',
        apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
      });
    });

    it('should use a generated name and the default workspace when the cluster has no name yet', async() => {
      const infra = createResource({ metadata: {}, spec: {} }, { saved: { metadata: { name: 'infra-abc', namespace: DEFAULT_WORKSPACE } } });
      const value: ClusterValue = { spec: { rkeConfig: { machinePools: [] } } };

      await saveInfrastructureCluster(value, infra, createContext());

      expect(infra.metadata).toStrictEqual({
        namespace: DEFAULT_WORKSPACE, generateName: 'infra-', labels: { [CLEANUP_LABEL]: 'true' }
      });
      expect(value.spec.rkeConfig).toStrictEqual({
        machinePools:      [],
        infrastructureRef: {
          kind: 'AWSCluster', name: 'infra-abc', namespace: DEFAULT_WORKSPACE, apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2'
        }
      });
    });

    it('should merge the cleanup label into existing labels of a new AWSCluster', async() => {
      const infra = createResource({ metadata: { labels: { team: 'capi' } }, spec: {} }, { saved: { metadata: { name: 'c', namespace: 'ns' } } });

      await saveInfrastructureCluster({ metadata: { name: 'c', namespace: 'ns' }, spec: {} }, infra, createContext());

      expect(infra.metadata.labels).toStrictEqual({ team: 'capi', [CLEANUP_LABEL]: 'true' });
    });

    const duplicatedRules = () => {
      const rule = {
        protocol: 'tcp', fromPort: 22, toPort: 22
      };

      return {
        rule,
        spec: { network: { additionalNodeIngressRules: [rule, { ...rule }], cni: { cniIngressRules: [rule, rule] } } },
      };
    };

    it('should drop duplicate ingress rules before creating the AWSCluster', async() => {
      const { rule, spec } = duplicatedRules();
      const infra = createResource({ metadata: { name: 'c' }, spec }, { saved: { metadata: { name: 'c', namespace: 'ns' } } });

      await saveInfrastructureCluster({ metadata: { name: 'c' }, spec: {} }, infra, createContext());

      expect(infra.spec.network).toStrictEqual({ additionalNodeIngressRules: [rule], cni: { cniIngressRules: [rule] } });
      expect(infra.save).toHaveBeenCalledTimes(1);
    });

    it('should drop duplicate ingress rules before patching the AWSCluster', async() => {
      const { rule, spec } = duplicatedRules();
      const initial = createResource({ metadata: { name: 'c' }, spec: {} });
      const infra = createResource({ metadata: { name: 'c' }, spec }, { patchable: true });

      await saveInfrastructureCluster({ metadata: { name: 'c' }, spec: {} }, infra, createContext(), true, initial);

      expect(infra.patch).toHaveBeenCalledWith({ spec: { network: { additionalNodeIngressRules: [rule], cni: { cniIngressRules: [rule] } } } }, expect.anything());
      expect(infra.save).not.toHaveBeenCalled();
    });

    it('should wrap save errors in a translated message', async() => {
      const infra = createResource({ metadata: {}, spec: {} }, { saveImpl: jest.fn().mockRejectedValue(new Error('forbidden')) });

      await expect(saveInfrastructureCluster({ metadata: { name: 'c' }, spec: {} }, infra, createContext())).rejects.toThrow('capa.errors.savingInfrastructureCluster:forbidden');
    });

    it.each([
      ['a 409 status', { status: 409 }],
      ['a 409 _status', { _status: 409 }],
      ['a "409" code', { code: '409' }],
      ['an "object has been modified" message', { message: 'Operation cannot be fulfilled: the object has been modified; please apply your changes' }],
    ])('should retry with the latest resourceVersion after a conflict reported as %s', async(_, conflict) => {
      const saveImpl = jest.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ metadata: { name: 'c', namespace: 'ns' } });
      const infra = createResource({ metadata: { resourceVersion: '1' }, spec: {} }, { saveImpl });
      const find = jest.fn(() => ({ metadata: { resourceVersion: '2' } }));
      const value: ClusterValue = { metadata: { name: 'c', namespace: 'ns' }, spec: {} };

      await saveInfrastructureCluster(value, infra, createContext({ 'management/find': find }));

      expect(find).toHaveBeenCalledWith({
        type: AWS_CLUSTER_SCHEMA, id: 'ns/c', opt: { force: true, watch: false }
      });
      expect(saveImpl).toHaveBeenCalledTimes(2);
      expect(infra.metadata.resourceVersion).toBe('2');
      expect(value.spec.rkeConfig?.infrastructureRef?.name).toBe('c');
    });

    it('should give up after three conflicting attempts', async() => {
      const conflict = { status: 409, message: 'conflict' };
      const saveImpl = jest.fn().mockRejectedValue(conflict);
      const infra = createResource({ metadata: {}, spec: {} }, { saveImpl });

      await expect(saveInfrastructureCluster({ metadata: { name: 'c' }, spec: {} }, infra, createContext({ 'management/find': () => ({ metadata: {} }) })))
        .rejects.toThrow('capa.errors.savingInfrastructureCluster:conflict');
      expect(saveImpl).toHaveBeenCalledTimes(3);
    });

    it('should not retry a conflict for a resource that only has a generated name', async() => {
      const saveImpl = jest.fn().mockRejectedValue({ status: 409, message: 'conflict' });
      const infra = createResource({ metadata: {}, spec: {} }, { saveImpl });
      const context = createContext();

      await expect(saveInfrastructureCluster({ spec: {} }, infra, context)).rejects.toThrow('capa.errors.savingInfrastructureCluster:conflict');
      expect(saveImpl).toHaveBeenCalledTimes(1);
      expect(context.dispatch).not.toHaveBeenCalled();
    });

    it('should three-way merge background changes when an initial value is available', async() => {
      const initial = createResource({ metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'us-west-2' } });
      const saveImpl = jest.fn()
        .mockRejectedValueOnce({ status: 409 })
        .mockResolvedValueOnce({ metadata: { name: 'c', namespace: 'ns' } });
      const infra = createResource({ metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'us-west-2', sshKeyName: 'mine' } }, { saveImpl });
      const server = createResource({
        metadata: {
          name: 'c', namespace: 'ns', resourceVersion: '5'
        },
        spec: { region: 'us-west-2', additionalTags: { a: 'b' } }
      });
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});

      await saveInfrastructureCluster({ metadata: { name: 'c', namespace: 'ns' }, spec: {} }, infra, createContext({ 'management/find': () => server }), false, initial);

      expect(saveImpl).toHaveBeenCalledTimes(2);
      expect(infra.metadata.resourceVersion).toBe('5');
      // the controller's change has been applied on top of the user's change
      expect(infra.spec).toStrictEqual({
        region: 'us-west-2', sshKeyName: 'mine', additionalTags: { a: 'b' }
      });
      log.mockRestore();
    });

    it('should surface genuine conflicts from the three-way merge', async() => {
      const initial = createResource({ metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'us-west-2' } });
      const saveImpl = jest.fn().mockRejectedValue({ status: 409 });
      const infra = createResource({ metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'us-east-1' } }, { saveImpl });
      const server = createResource({ metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'eu-west-1' } });

      jest.spyOn(console, 'log').mockImplementation(() => {});

      await expect(saveInfrastructureCluster({ metadata: { name: 'c', namespace: 'ns' }, spec: {} }, infra, createContext({ 'management/find': () => server }), false, initial))
        .rejects.toThrow('capa.errors.savingInfrastructureCluster:validation.conflict');
      expect(saveImpl).toHaveBeenCalledTimes(1);
    });

    describe('when editing', () => {
      const editable = (data: Record<string, any>) => {
        const resource = createResource(data);

        resource.patch = jest.fn(async() => resource);

        return resource;
      };

      it('should merge-patch only the changed fields and leave the identity alone', async() => {
        const initial = createResource({
          type: AWS_CLUSTER_SCHEMA, metadata: { name: 'c', namespace: 'ns' }, spec: { region: 'us-west-2', additionalTags: { a: '1' } }
        });
        const infra = editable({
          type:     AWS_CLUSTER_SCHEMA,
          metadata: {
            name: 'c', namespace: 'ns', labels: { x: 'y' }
          },
          spec: { region: 'us-west-2', additionalTags: { a: '2' } }
        });
        const value: ClusterValue = { metadata: { name: 'other', namespace: 'other' }, spec: {} };

        await saveInfrastructureCluster(value, infra, createContext(), true, initial);

        expect(infra.patch).toHaveBeenCalledWith({ spec: { additionalTags: { a: '2' } } }, { headers: { 'content-type': 'application/merge-patch+json' } });
        expect(infra.save).not.toHaveBeenCalled();
        expect(infra.metadata).toStrictEqual({
          name: 'c', namespace: 'ns', labels: { x: 'y' }
        });
        // the infrastructureRef is only set when the AWSCluster is first created
        expect(value.spec.rkeConfig).toBeUndefined();
      });

      it('should not send a patch when nothing changed', async() => {
        const initial = createResource({ metadata: { name: 'c' }, spec: { region: 'us-west-2' } });
        const infra = editable({ metadata: { name: 'c', resourceVersion: '2' }, spec: { region: 'us-west-2' } });

        await saveInfrastructureCluster({ spec: {} }, infra, createContext(), true, initial);

        expect(infra.patch).not.toHaveBeenCalled();
        expect(infra.save).not.toHaveBeenCalled();
      });

      it('should fall back to a full save when there is no initial value', async() => {
        const infra = editable({ metadata: { name: 'c' }, spec: {} });

        await saveInfrastructureCluster({ spec: {} }, infra, createContext(), true, null);

        expect(infra.patch).not.toHaveBeenCalled();
        expect(infra.save).toHaveBeenCalledTimes(1);
      });

      it('should wrap patch errors in a translated message', async() => {
        const initial = createResource({ metadata: { name: 'c' }, spec: { region: 'a' } });
        const infra = editable({ metadata: { name: 'c' }, spec: { region: 'b' } });

        infra.patch.mockRejectedValue(new Error('bad patch'));

        await expect(saveInfrastructureCluster({ spec: {} }, infra, createContext(), true, initial)).rejects.toThrow('capa.errors.savingInfrastructureCluster:bad patch');
      });
    });
  });

  describe('fx: removeEmptyFields', () => {
    it.each([
      ['undefined', undefined, undefined],
      ['null', null, undefined],
      ['an empty string', '', undefined],
      ['an empty array', [], undefined],
      ['an empty object', {}, undefined],
      ['zero', 0, 0],
      ['false', false, false],
      ['a string', 'a', 'a'],
      ['an array of empties', [null, '', {}, []], undefined],
      ['an array with some values', [null, 'a', 0, ''], ['a', 0]],
      ['an object of empties', {
        a: null, b: '', c: { d: [] }
      }, undefined],
      [
        'a nested object',
        {
          region: 'us-west-2', sshKeyName: '', network: { vpc: { id: '' }, subnets: [{ id: 's-1' }, {}] }, publicIP: false
        },
        {
          region: 'us-west-2', network: { subnets: [{ id: 's-1' }] }, publicIP: false
        }
      ],
    ])('should clean %s', (_, input, expected) => {
      expect(removeEmptyFields(input)).toStrictEqual(expected);
    });

    it('should not mutate the input', () => {
      const input = { a: '', b: { c: null } };

      removeEmptyFields(input);

      expect(input).toStrictEqual({ a: '', b: { c: null } });
    });
  });

  describe('fx: dedupeIngressRules', () => {
    const a = {
      protocol: 'tcp', fromPort: 22, toPort: 22
    };
    const b = {
      protocol: 'udp', fromPort: 4789, toPort: 4789
    };
    const aDescribed = { ...a, description: 'ssh' };

    it.each([
      ['no rules', [], []],
      ['unique rules', [a, b], [a, b]],
      ['a repeated rule', [a, b, a], [a, b]],
      ['a deep-equal copy', [a, { ...a }], [a]],
      ['rules that differ only by description', [a, aDescribed], [a, aDescribed]],
      ['deep-equal nested arrays', [{ ...a, cidrBlocks: ['10.0.0.0/8'] }, { ...a, cidrBlocks: ['10.0.0.0/8'] }], [{ ...a, cidrBlocks: ['10.0.0.0/8'] }]],
      ['nested arrays in a different order', [{ ...a, cidrBlocks: ['1.0.0.0/8', '2.0.0.0/8'] }, { ...a, cidrBlocks: ['2.0.0.0/8', '1.0.0.0/8'] }], [{ ...a, cidrBlocks: ['1.0.0.0/8', '2.0.0.0/8'] }, { ...a, cidrBlocks: ['2.0.0.0/8', '1.0.0.0/8'] }]],
    ])('should handle %s', (_, rules, expected) => {
      expect(dedupeIngressRules(rules)).toStrictEqual(expected);
    });

    it('should keep the first occurrence and the original order', () => {
      const first = { ...b };
      const res = dedupeIngressRules([b, a, first, a]);

      expect(res).toStrictEqual([b, a]);
      expect(res[0]).toBe(b);
    });

    it('should return a new array without mutating the input', () => {
      const rules = [a, a];
      const res = dedupeIngressRules(rules);

      expect(res).not.toBe(rules);
      expect(rules).toStrictEqual([a, a]);
    });

    it.each([undefined, null])('should treat %p as an empty list', (rules) => {
      expect(dedupeIngressRules(rules as any)).toStrictEqual([]);
    });
  });

  describe('fx: dedupeInfrastructureClusterIngressRules', () => {
    const rule = {
      protocol: 'tcp', fromPort: 443, toPort: 443
    };
    const other = {
      protocol: 'udp', fromPort: 8472, toPort: 8472
    };

    it.each([
      ['additionalControlPlaneIngressRules', (spec: any) => spec.network.additionalControlPlaneIngressRules],
      ['additionalNodeIngressRules', (spec: any) => spec.network.additionalNodeIngressRules],
      ['cni.cniIngressRules', (spec: any) => spec.network.cni.cniIngressRules],
    ])('should dedupe %s', (_, read) => {
      const spec = {
        network: {
          additionalControlPlaneIngressRules: [rule, other, { ...rule }],
          additionalNodeIngressRules:         [rule, other, { ...rule }],
          cni:                                { cniIngressRules: [rule, other, { ...rule }] },
        }
      };

      dedupeInfrastructureClusterIngressRules(spec);

      expect(read(spec)).toStrictEqual([rule, other]);
    });

    it('should leave lists that are already unique as the same array', () => {
      const cpRules = [rule, other];
      const nodeRules = [rule];
      const cniRules = [other];
      const spec = {
        network: {
          additionalControlPlaneIngressRules: cpRules, additionalNodeIngressRules: nodeRules, cni: { cniIngressRules: cniRules }
        }
      };

      dedupeInfrastructureClusterIngressRules(spec);

      expect(spec.network.additionalControlPlaneIngressRules).toBe(cpRules);
      expect(spec.network.additionalNodeIngressRules).toBe(nodeRules);
      expect(spec.network.cni.cniIngressRules).toBe(cniRules);
    });

    it.each([
      ['an undefined spec', undefined],
      ['a spec without a network', { region: 'us-west-2' }],
      ['a network without a cni', { network: { vpc: { id: 'vpc-1' } } }],
      ['a cni without rules', { network: { cni: {} } }],
      ['rule lists that are not arrays', { network: { additionalNodeIngressRules: null, cni: { cniIngressRules: 'nope' } } }],
    ])('should cope with %s', (_, spec) => {
      const before = JSON.parse(JSON.stringify(spec ?? null));

      expect(() => dedupeInfrastructureClusterIngressRules(spec)).not.toThrow();
      expect(spec ?? null).toStrictEqual(before);
    });
  });

  describe('fx: isCapaManagedVpcId', () => {
    const vpcs: VPC[] = [
      { VpcId: 'vpc-capa', Tags: [{ Key: 'Name', Value: 'x' }, { Key: 'sigs.k8s.io/cluster-api-provider-aws/cluster/my-cluster', Value: 'owned' }] },
      { VpcId: 'vpc-user', Tags: [{ Key: 'Name', Value: 'mine' }] },
      { VpcId: 'vpc-untagged' },
      // tags without a key are tolerated
      { VpcId: 'vpc-keyless', Tags: [{ Value: 'v' }] } as VPC,
    ];

    it.each([
      ['vpc-capa', true],
      ['vpc-user', false],
      ['vpc-untagged', false],
      ['vpc-keyless', false],
      ['vpc-unknown', false],
      ['', false],
    ])('should return %p for %p', (vpcId, expected) => {
      expect(isCapaManagedVpcId(vpcId, vpcs)).toBe(expected);
    });

    it('should default to not managed when called without arguments', () => {
      expect(isCapaManagedVpcId()).toBe(false);
    });
  });
});
