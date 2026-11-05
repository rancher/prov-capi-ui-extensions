import { reactive } from 'vue';
import { shallowMount, flushPromises, VueWrapper } from '@vue/test-utils';
import { _CREATE, _EDIT, _VIEW } from '@shell/config/query-params';
import { NORMAN } from '@shell/config/types';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import KeyValue from '@shell/components/form/KeyValue.vue';
import Banner from '@components/Banner/Banner.vue';
import InfrastructureClusterConfiguration from '../InfrastructureClusterConfiguration.vue';
import Networking from '../Networking.vue';
import { DEFAULT_CLUSTER_CONFIG } from '../constants';
import { CAPA } from '../../labels-annotations';
import {
  createAwsStore, depaginateCalls, REGIONS, VPCS, SUBNETS, SECURITY_GROUPS
} from '../../__tests__/fixtures/aws';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable', 'expanded'],
  template: '<section><slot /></section>',
};

const CREDENTIAL_ID = 'cattle-global-data:cc-abc';

const credential = (annotations: Record<string, string> = { [CAPA.IDENTITY_REF]: 'capa-identity' }, defaultRegion = 'eu-west-1') => ({
  id: CREDENTIAL_ID, annotations, amazonec2credentialConfig: { defaultRegion }
});

type WrapperOptions = {
  value?: Record<string, any>;
  mode?: string;
  credentialId?: string | null;
  provisioningCluster?: Record<string, any>;
  overrides?: Record<string, (payload: any) => any>;
};

const createWrapper = ({
  value = { spec: {} }, mode = _CREATE, credentialId = CREDENTIAL_ID, provisioningCluster, overrides = {}
}: WrapperOptions = {}) => {
  const store = createAwsStore({ 'rancher/find': () => credential(), ...overrides });
  const reactiveValue = reactive(value);
  const wrapper: VueWrapper<any> = shallowMount(InfrastructureClusterConfiguration, {
    props: {
      value: reactiveValue, mode, credentialId, provisioningCluster
    },
    global: {
      provide: { store },
      mocks:   { $store: store },
      stubs:   { RcSection: RcSectionStub },
    },
  });

  return {
    wrapper, store, value: reactiveValue
  };
};

// The AWS lookups are debounced by 1ms
const waitForAwsCalls = async() => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await flushPromises();
};

const selects = (wrapper: any) => {
  const [region, sshKey] = wrapper.findAllComponents(LabeledSelect);

  return { region, sshKey };
};

describe('component: InfrastructureClusterConfiguration', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should apply the default AWSCluster config on mount, keeping user values', async() => {
      const { wrapper } = createWrapper({ value: { spec: { sshKeyName: 'mine' } }, credentialId: null });

      await flushPromises();

      const [[emitted]] = wrapper.emitted('update:value') as any[];

      expect(emitted.spec.network).toStrictEqual(DEFAULT_CLUSTER_CONFIG.spec.network);
      expect(emitted.spec.controlPlaneLoadBalancer).toStrictEqual(DEFAULT_CLUSTER_CONFIG.spec.controlPlaneLoadBalancer);
      expect(emitted.spec.sshKeyName).toBe('mine');
    });

    it.each([
      ['a single custom rule', [{
        protocol: 'tcp', fromPort: 22, toPort: 22
      }]],
      ['the default rules (mounting again)', DEFAULT_CLUSTER_CONFIG.spec.network.additionalNodeIngressRules],
      ['no rules', []],
    ])('should let the value\'s own node ingress rules replace the defaults: %s', async(_, rules) => {
      const { wrapper } = createWrapper({ value: { spec: { network: { additionalNodeIngressRules: rules } } }, credentialId: null });

      await flushPromises();

      const [[emitted]] = wrapper.emitted('update:value') as any[];

      // not merged index-by-index into, or appended to, the default rules
      expect(emitted.spec.network.additionalNodeIngressRules).toStrictEqual(rules);
      // and copied, so later edits don't leak into the defaults
      expect(emitted.spec.network.additionalNodeIngressRules).not.toBe(rules);
      expect(DEFAULT_CLUSTER_CONFIG.spec.network.additionalNodeIngressRules).toHaveLength(2);
    });

    it('should load the cloud credential and set the region and identity from it', async() => {
      const { store, value } = createWrapper();

      await waitForAwsCalls();

      expect(store.dispatch).toHaveBeenCalledWith('rancher/find', {
        type: NORMAN.CLOUD_CREDENTIAL, id: CREDENTIAL_ID, opt: { force: true }
      });
      expect(value.spec.region).toBe('eu-west-1');
      expect(value.spec.identityRef).toStrictEqual({ name: 'capa-identity', kind: 'AWSClusterStaticIdentity' });
    });

    it('should fall back to the default aws region when the credential has none', async() => {
      const { value } = createWrapper({ overrides: { 'rancher/find': () => credential(undefined, '') } });

      await waitForAwsCalls();

      expect(value.spec.region).toBe('us-west-2');
    });

    it('should keep a region that is already set', async() => {
      const { value, store } = createWrapper({ value: { spec: { region: 'us-east-1' } } });

      await waitForAwsCalls();

      expect(value.spec.region).toBe('us-east-1');
      expect(store.dispatch).toHaveBeenCalledWith('aws/ec2', { region: 'us-east-1', cloudCredentialId: CREDENTIAL_ID });
    });

    it('should fetch the aws resources and pass them to the form', async() => {
      const { wrapper, store } = createWrapper();

      await waitForAwsCalls();

      expect(store.dispatch).toHaveBeenCalledWith('aws/ec2', { region: 'eu-west-1', cloudCredentialId: CREDENTIAL_ID });
      expect(depaginateCalls(store.dispatch)).toStrictEqual(['describeRegions', 'describeKeyPairs', 'describeVpcs', 'describeSubnets', 'describeSecurityGroups']);

      store.dispatch.mock.calls.filter(([action]) => action === 'aws/depaginateList').forEach(([, payload]) => {
        expect(payload.client).toStrictEqual({ client: 'ec2', region: 'eu-west-1' });
      });

      const { region, sshKey } = selects(wrapper);

      expect(region.props('options')).toStrictEqual(REGIONS.map((r) => r.RegionName).sort());
      expect(region.props('disabled')).toBe(false);
      expect((sshKey.props('options') as any[]).slice(0, 3)).toStrictEqual([
        { label: 'capa.clusterConfig.sshKeyName.noneLabel', value: '' },
        { label: 'alice', value: 'alice' },
        { label: 'bob', value: 'bob' },
      ]);

      const networking = wrapper.findComponent(Networking);

      expect(networking.props('vpcInfo')).toStrictEqual(VPCS);
      expect(networking.props('subnetInfo')).toStrictEqual(SUBNETS);
      expect(networking.props('securityGroupInfo')).toStrictEqual(SECURITY_GROUPS);
      expect(networking.props('loadingVpcs')).toBe(false);
    });

    it('should clear the vpc and ssh key and not refetch regions when the region changes', async() => {
      const { wrapper, store, value } = createWrapper({ value: { spec: { sshKeyName: 'alice', network: { vpc: { id: 'vpc-user' } } } } });

      await waitForAwsCalls();
      store.dispatch.mockClear();

      selects(wrapper).region.vm.$emit('update:value', 'us-east-1');
      await waitForAwsCalls();

      expect(value.spec.region).toBe('us-east-1');
      expect(value.spec.sshKeyName).toBe('');
      expect(value.spec.network.vpc.id).toBe('');
      expect(store.dispatch).toHaveBeenCalledWith('aws/ec2', { region: 'us-east-1', cloudCredentialId: CREDENTIAL_ID });
      expect(depaginateCalls(store.dispatch)).not.toContain('describeRegions');
      expect(depaginateCalls(store.dispatch)).toContain('describeVpcs');
    });

    it('should report the form as valid once the identity is set', async() => {
      const { wrapper } = createWrapper();

      await waitForAwsCalls();

      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([true]);
    });

    it('should show an error when loading the credential fails', async() => {
      const { wrapper, store } = createWrapper({
        overrides: {
          'rancher/find': () => {
            throw new Error('not found');
          }
        }
      });

      await waitForAwsCalls();

      const labels = wrapper.findAllComponents(Banner).map((b) => b.props('label'));

      expect(labels).toHaveLength(1);
      expect(labels[0]).toContain('capa.errors.fetchingCloudCredential');
      // there is no region to query
      expect(store.dispatch).not.toHaveBeenCalledWith('aws/ec2', expect.anything());
    });

    it.each([
      ['describeRegions', 'capa.errors.fetchingRegions'],
      ['describeKeyPairs', 'capa.errors.fetchingSshKeys'],
      ['describeVpcs', 'capa.errors.fetchingVpcs'],
      ['describeSubnets', 'capa.errors.fetchingSubnets'],
      ['describeSecurityGroups', 'capa.errors.fetchingSecurityGroups'],
    ])('should show an error when %s fails', async(cmd, errorKey) => {
      const { wrapper } = createWrapper({
        overrides: {
          'aws/depaginateList': (payload) => {
            if (payload.cmd === cmd) {
              throw new Error('denied');
            }

            return [];
          }
        }
      });

      await waitForAwsCalls();

      const labels = wrapper.findAllComponents(Banner).map((b) => b.props('label'));

      expect(labels).toHaveLength(1);
      expect(labels[0]).toContain(errorKey);
    });

    describe('identity reference', () => {
      it('should retry until the identity annotation appears', async() => {
        jest.useFakeTimers();
        const find = jest.fn()
          .mockResolvedValueOnce(credential({}))
          .mockResolvedValueOnce(credential({}))
          .mockResolvedValue(credential());
        const { wrapper, value } = createWrapper({ overrides: { 'rancher/find': find } });

        await flushPromises();
        expect(value.spec.identityRef).toBeUndefined();

        jest.advanceTimersByTime(500);
        await flushPromises();
        expect(value.spec.identityRef).toBeUndefined();

        jest.advanceTimersByTime(500);
        await flushPromises();
        expect(value.spec.identityRef).toStrictEqual({ name: 'capa-identity', kind: 'AWSClusterStaticIdentity' });

        jest.advanceTimersByTime(5000);
        await flushPromises();
        // the retry loop stops once the annotation was found
        expect(find).toHaveBeenCalledTimes(3);
        expect(wrapper.findAllComponents(Banner)).toHaveLength(0);
      });

      it.each([
        ['the annotation never appears', () => Promise.resolve(credential({}))],
        ['the lookups keep failing', () => Promise.reject(new Error('nope'))],
      ])('should show an error after 5 seconds when %s', async(_, retry) => {
        jest.useFakeTimers();
        const find = jest.fn().mockResolvedValueOnce(credential({})).mockImplementation(retry);
        const { wrapper, value } = createWrapper({ overrides: { 'rancher/find': find } });

        await flushPromises();

        for (let i = 0; i < 9; i++) {
          jest.advanceTimersByTime(500);
          await flushPromises();
        }

        expect(wrapper.findAllComponents(Banner)).toHaveLength(0);

        jest.advanceTimersByTime(500);
        await flushPromises();

        const banners = wrapper.findAllComponents(Banner);

        expect(banners).toHaveLength(1);
        expect(banners[0].props('label')).toBe('%capa.errors.missingIdentityRef%');
        expect(value.spec.identityRef).toBeUndefined();

        jest.advanceTimersByTime(5000);
        await flushPromises();
        expect(find).toHaveBeenCalledTimes(11);
      });

      it('should report the form as invalid without an identity', async() => {
        jest.useFakeTimers();
        const { wrapper } = createWrapper({ value: { spec: { identityRef: { name: 'old', kind: 'AWSClusterStaticIdentity' } } }, overrides: { 'rancher/find': () => credential({}) } });

        await flushPromises();

        // the stale identity is removed when the credential is (re)loaded
        expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([false]);
      });

      it('should stop retrying for a credential that is no longer selected', async() => {
        jest.useFakeTimers();
        const find = jest.fn((payload: any) => Promise.resolve(payload.id === 'other' ? credential() : credential({})));
        const store = createAwsStore({ 'rancher/find': find });
        const wrapper: VueWrapper<any> = shallowMount(InfrastructureClusterConfiguration, {
          props: {
            value: reactive({ spec: {} }), mode: _CREATE, credentialId: CREDENTIAL_ID
          },
          global: { provide: { store }, stubs: { RcSection: RcSectionStub } },
        });

        await flushPromises();
        await wrapper.setProps({ credentialId: 'other' });
        await flushPromises();

        const callsAfterSwitch = find.mock.calls.length;

        jest.advanceTimersByTime(5000);
        await flushPromises();

        expect(find.mock.calls.slice(callsAfterSwitch).filter(([payload]) => payload.id === CREDENTIAL_ID)).toHaveLength(0);
      });
    });
  });

  describe('edit', () => {
    it('should not reload the credential or apply defaults, but still load aws resources', async() => {
      const { wrapper, store } = createWrapper({ mode: _EDIT, value: { spec: { region: 'us-west-2', identityRef: { name: 'id', kind: 'AWSClusterStaticIdentity' } } } });

      await waitForAwsCalls();

      expect(store.dispatch).not.toHaveBeenCalledWith('rancher/find', expect.anything());
      expect(wrapper.emitted('update:value')).toBeUndefined();
      expect(store.dispatch).toHaveBeenCalledWith('aws/ec2', { region: 'us-west-2', cloudCredentialId: CREDENTIAL_ID });
      expect(selects(wrapper).region.props('disabled')).toBe(true);
    });
  });

  describe('view', () => {
    it('should not call aws at all', async() => {
      const { store, wrapper } = createWrapper({ mode: _VIEW, value: { spec: { region: 'us-west-2' } } });

      await waitForAwsCalls();

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(selects(wrapper).region.props('mode')).toBe(_VIEW);
    });
  });

  it('should not call aws without a credential', async() => {
    const { store, wrapper } = createWrapper({ credentialId: null, value: { spec: { region: 'us-west-2' } } });

    await waitForAwsCalls();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(selects(wrapper).region.props('options')).toStrictEqual([]);
  });

  describe('form updates', () => {
    it('should write the ssh key and tags to the spec', () => {
      const { wrapper, value } = createWrapper({ credentialId: null });

      selects(wrapper).sshKey.vm.$emit('update:value', 'bob');
      wrapper.findComponent(KeyValue).vm.$emit('update:value', { team: 'capi' });

      expect(value.spec.sshKeyName).toBe('bob');
      expect(value.spec.additionalTags).toStrictEqual({ team: 'capi' });
      expect(wrapper.emitted('update:value')?.length).toBeGreaterThanOrEqual(2);
    });

    it('should write the networking config to the spec', () => {
      const { wrapper, value } = createWrapper({ credentialId: null, value: { spec: { network: { vpc: { id: 'vpc-old' } } } } });
      const networking = wrapper.findComponent(Networking);

      networking.vm.$emit('update:subnets', [{ id: 'subnet-a' }]);
      networking.vm.$emit('update:cidrBlock', '10.0.0.0/16');
      networking.vm.$emit('update:securityGroupOverrides', { node: 'sg-1' });
      networking.vm.$emit('update:additionalControlPlaneIngressRules', [{ protocol: 'tcp' }]);
      networking.vm.$emit('update:additionalNodeIngressRules', [{ protocol: 'udp' }]);
      networking.vm.$emit('update:cniIngressRules', [{ protocol: 'icmp' }]);
      networking.vm.$emit('update:ipv6', {});

      expect(value.spec.network).toStrictEqual({
        vpc:                                { id: 'vpc-old', cidrBlock: '10.0.0.0/16' },
        subnets:                            [{ id: 'subnet-a' }],
        securityGroupOverrides:             { node: 'sg-1' },
        additionalControlPlaneIngressRules: [{ protocol: 'tcp' }],
        additionalNodeIngressRules:         [{ protocol: 'udp' }],
        cni:                                { cniIngressRules: [{ protocol: 'icmp' }] },
        ipv6:                               {},
      });

      networking.vm.$emit('update:ipv6', undefined);
      networking.vm.$emit('update:vpcId', null);
      networking.vm.$emit('update:subnets', null);

      expect(value.spec.network.ipv6).toBeUndefined();
      expect(value.spec.network.vpc).toStrictEqual({ cidrBlock: '10.0.0.0/16' });
      expect(value.spec.network.subnets).toBeUndefined();
    });

    it('should clear security group overrides when switching back to a managed network', async() => {
      const { wrapper, value } = createWrapper({ credentialId: null, value: { spec: { network: { securityGroupOverrides: { node: 'sg-1' } } } } });
      const networking = wrapper.findComponent(Networking);

      networking.vm.$emit('update:useUnmanagedNetwork', true);
      await flushPromises();
      expect(value.spec.network.securityGroupOverrides).toStrictEqual({ node: 'sg-1' });

      networking.vm.$emit('update:useUnmanagedNetwork', false);
      await flushPromises();
      expect(value.spec.network.securityGroupOverrides).toStrictEqual({});
    });

    it('should only require a vpc and subnets for unmanaged networks', async() => {
      const { wrapper } = createWrapper({ credentialId: null });
      const networking = () => wrapper.findComponent(Networking);
      const run = (prop: string, val: unknown) => (networking().props(prop) as any[]).map((rule) => rule(val)).filter(Boolean);

      expect(run('vpcValidators', '')).toStrictEqual([]);
      expect(run('subnetValidators', [])).toStrictEqual([]);
      expect(run('cidrBlockValidators', 'nope')).toStrictEqual(['capa.errors.vpcCidrBlock']);

      networking().vm.$emit('update:useUnmanagedNetwork', true);
      await flushPromises();

      expect(run('vpcValidators', '')).toStrictEqual(['capa.errors.vpcRequired']);
      expect(run('subnetValidators', [])).toStrictEqual(['capa.errors.subnetRequired']);
      expect(run('cidrBlockValidators', 'nope')).toStrictEqual([]);
    });

    it('should validate the region and the ingress rule cidr blocks', () => {
      const { wrapper, value } = createWrapper({ credentialId: null });
      const networking = wrapper.findComponent(Networking);
      const [regionRule] = selects(wrapper).region.props('rules') as any[];

      expect(regionRule('')).toBe('capa.errors.regionRequired');
      expect(regionRule('us-west-2')).toBeUndefined();

      value.spec.network = { additionalControlPlaneIngressRules: [{ protocol: 'tcp', cidrBlocks: ['bad'] }], additionalNodeIngressRules: [{ protocol: 'tcp', ipv6CidrBlocks: ['bad'] }] };

      const [cpRule] = networking.props('additionalControlPlaneIngressRulesValidators') as any[];
      const [nodeRule] = networking.props('additionalNodeIngressRulesValidators') as any[];

      expect(cpRule()).toBe('capa.errors.invalidIpv4Cidr');
      expect(nodeRule()).toBe('capa.errors.invalidIpv6Cidr');
    });

    it('should pass the provisioning cluster to the networking section', () => {
      const provisioningCluster = { spec: { rkeConfig: { machineGlobalConfig: { cni: 'calico' } } } };
      const { wrapper } = createWrapper({ credentialId: null, provisioningCluster });

      expect(wrapper.findComponent(Networking).props('provisioningCluster')).toStrictEqual(provisioningCluster);
    });
  });
});
