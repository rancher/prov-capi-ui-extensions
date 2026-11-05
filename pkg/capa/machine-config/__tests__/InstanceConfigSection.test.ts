import { shallowMount } from '@vue/test-utils';
import { _CREATE, _VIEW } from '@shell/config/query-params';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Checkbox } from '@components/Form/Checkbox';
import InstanceConfigSection from '../InstanceConfigSection.vue';
import { INSTANCE_TYPES, INSTANCE_PROFILES, KEY_PAIRS, SUBNETS } from '../../__tests__/fixtures/aws';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable', 'expanded'],
  template: '<section><slot /></section>',
};

const createWrapper = (props: Record<string, any> = {}) => shallowMount(InstanceConfigSection, {
  props,
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { RcSection: RcSectionStub },
  },
});

const fields = (wrapper: ReturnType<typeof createWrapper>) => {
  const [instanceType, sshKey, iamInstanceProfile, subnet, httpTokens] = wrapper.findAllComponents(LabeledSelect);

  return {
    instanceType, sshKey, iamInstanceProfile, subnet, httpTokens, ami: wrapper.findComponent(LabeledInput), publicIP: wrapper.findComponent(Checkbox)
  };
};

describe('component: InstanceConfigSection', () => {
  it('should show the defaults when no values are given', () => {
    const {
      instanceType, sshKey, iamInstanceProfile, subnet, httpTokens, ami, publicIP
    } = fields(createWrapper());

    expect(instanceType.props('value')).toBe('t3.medium');
    expect(sshKey.props('value')).toBe('');
    expect(iamInstanceProfile.props('value')).toBe('');
    expect(subnet.props('value')).toBe('__none__');
    expect(httpTokens.props('value')).toBe('required');
    expect(ami.props('value')).toBe('');
    expect(publicIP.props('value')).toBe(false);
  });

  it('should group the instance types by family', () => {
    const { instanceType } = fields(createWrapper({ instanceTypes: INSTANCE_TYPES }));

    expect(instanceType.props('options')).toStrictEqual([
      {
        kind: 'group', disabled: false, label: 'General Purpose'
      },
      { label: 't3.medium - 2 vCPU, 4 GiB', value: 't3.medium' },
      { label: 't3.large - 2 vCPU, 8 GiB', value: 't3.large' },
      {
        kind: 'group', disabled: false, label: 'Compute Optimized'
      },
      { label: 'c5.large - 2 vCPU, 4 GiB', value: 'c5.large' },
    ]);
  });

  it('should offer named key pairs plus a none option', () => {
    const { sshKey } = fields(createWrapper({ keyPairs: KEY_PAIRS }));

    expect(sshKey.props('options')).toStrictEqual([
      { label: 'capa.machineConfig.instanceConfiguration.sshKeyName.noneLabel', value: '' },
      { label: 'alice', value: 'alice' },
      { label: 'bob', value: 'bob' },
    ]);
  });

  it('should offer the named instance profiles and allow typing a custom one', () => {
    const { iamInstanceProfile } = fields(createWrapper({ instanceProfiles: INSTANCE_PROFILES }));

    expect(iamInstanceProfile.props('options')).toStrictEqual([
      'nodes.cluster-api-provider-aws.sigs.k8s.io',
      'control-plane.cluster-api-provider-aws.sigs.k8s.io',
    ]);
    expect(iamInstanceProfile.attributes('taggable')).toBe('true');
  });

  it('should pass the validation rules to the required fields', () => {
    const amiRules = [jest.fn()];
    const iamRules = [jest.fn()];
    const { ami, iamInstanceProfile } = fields(createWrapper({ rules: { amiId: amiRules, iamInstanceProfile: iamRules } }));

    expect(ami.props('rules')).toStrictEqual(amiRules);
    expect(ami.props('required')).toBe(true);
    expect(iamInstanceProfile.props('rules')).toStrictEqual(iamRules);
    expect(iamInstanceProfile.props('required')).toBe(true);
  });

  it.each([
    ['instanceType', 'update:instanceType', 't3.large'],
    ['sshKey', 'update:sshKeyName', 'alice'],
    ['iamInstanceProfile', 'update:iamInstanceProfile', 'my-profile'],
    ['httpTokens', 'update:instanceMetadataHttpTokens', 'optional'],
    ['ami', 'update:amiId', 'ami-123'],
    ['publicIP', 'update:publicIP', true],
  ])('should emit %p changes', (field, event, value) => {
    const wrapper = createWrapper();

    (fields(wrapper) as Record<string, any>)[field].vm.$emit('update:value', value);

    expect(wrapper.emitted(event)).toStrictEqual([[value]]);
  });

  it('should offer both instance metadata token options', () => {
    const { httpTokens } = fields(createWrapper());

    expect((httpTokens.props('options') as any[]).map((o) => o.value)).toStrictEqual(['required', 'optional']);
  });

  describe('subnet', () => {
    it('should only allow "none" until the cluster has a vpc', () => {
      const wrapper = createWrapper({ subnets: SUBNETS, subnetId: 'subnet-a' });
      const { subnet } = fields(wrapper);

      expect(subnet.props('value')).toBe('__none__');
      expect(subnet.props('options')).toStrictEqual([{ label: 'capa.machineConfig.instanceConfiguration.subnet.none', value: '__none__' }]);

      subnet.vm.$emit('update:value', 'subnet-a');

      expect(wrapper.emitted('update:subnetId')).toStrictEqual([[null]]);
    });

    it('should offer the vpc subnets, sorted by name', () => {
      const { subnet } = fields(createWrapper({
        subnets: [...SUBNETS, { id: 'subnet-from-cluster' }, { VpcId: 'vpc-user' }], vpcId: 'vpc-user', subnetId: 'subnet-b'
      }));

      expect(subnet.props('value')).toBe('subnet-b');
      expect(subnet.props('options')).toStrictEqual([
        { label: 'capa.machineConfig.instanceConfiguration.subnet.none', value: '__none__' },
        { label: 'private-a (subnet-a)', value: 'subnet-a' },
        { label: 'private-b (subnet-b)', value: 'subnet-b' },
        { label: 'subnet-from-cluster', value: 'subnet-from-cluster' },
      ]);
    });

    it.each([
      ['subnet-a', 'subnet-a'],
      ['__none__', null],
    ])('should emit %p as %p', (selected, expected) => {
      const wrapper = createWrapper({ subnets: SUBNETS, vpcId: 'vpc-user' });

      fields(wrapper).subnet.vm.$emit('update:value', selected);

      expect(wrapper.emitted('update:subnetId')).toStrictEqual([[expected]]);
    });
  });

  describe('machine image', () => {
    it('should label an auto-populated ubuntu image', () => {
      const { ami } = fields(createWrapper({
        amiId: 'ami-new', isAmiAutoPopulated: true, autoPopulatedAmiId: 'ami-new'
      }));

      expect(ami.props('value')).toBe('ami-new (capa.machineConfig.instanceConfiguration.advanced.machineImage.latestUbuntu)');
      expect(ami.props('placeholder')).toBe('ami-new');
    });

    it('should show a user-provided image as-is', () => {
      const { ami } = fields(createWrapper({ amiId: 'ami-custom', autoPopulatedAmiId: 'ami-new' }));

      expect(ami.props('value')).toBe('ami-custom');
      expect(ami.props('placeholder')).toBe('ami-new');
    });
  });

  it.each([_CREATE, _VIEW])('should pass the %p mode to every field', (mode) => {
    const wrapper = createWrapper({ mode });

    [...wrapper.findAllComponents(LabeledSelect), wrapper.findComponent(LabeledInput), wrapper.findComponent(Checkbox)].forEach((field) => {
      expect(field.props('mode')).toBe(mode);
    });
  });

  it('should pass the loading states to the selects', () => {
    const {
      instanceType, sshKey, iamInstanceProfile, subnet
    } = fields(createWrapper({
      loadingInstanceTypes: true, loadingSshKeys: true, loadingInstanceProfiles: true, loadingSubnets: true
    }));

    [instanceType, sshKey, iamInstanceProfile, subnet].forEach((select) => {
      expect(select.props('loading')).toBe(true);
    });
  });
});
