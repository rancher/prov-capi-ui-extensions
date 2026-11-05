import { nextTick } from 'vue';
import { shallowMount, VueWrapper } from '@vue/test-utils';
import { _CREATE, _EDIT, _VIEW } from '@shell/config/query-params';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import RadioGroup from '@components/Form/Radio/RadioGroup.vue';
import Checkbox from '@components/Form/Checkbox/Checkbox.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import Networking from '../Networking.vue';
import IngressRules from '../IngressRules.vue';
import SecurityOverrides from '../SecurityOverrides.vue';
import { CNI_INGRESS_RULES } from '../constants';
import { VPCS, SUBNETS } from '../../__tests__/fixtures/aws';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable', 'expanded'],
  template: '<section :data-title="title"><slot /></section>',
};

const BannerStub = {
  name:     'Banner',
  props:    ['color', 'label'],
  template: '<div class="banner-stub" :data-color="color"><slot /></div>',
};

const createWrapper = (props: Record<string, any> = {}): VueWrapper<any> => shallowMount(Networking, {
  props: {
    vpcId: '', subnets: [], ...props
  },
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { RcSection: RcSectionStub, Banner: BannerStub },
  },
});

const ingressRules = (wrapper: ReturnType<typeof createWrapper>) => {
  return wrapper.findAllComponents(IngressRules).reduce((acc, c) => {
    acc[c.props('titlePrefix') as string] = c;

    return acc;
  }, {} as Record<string, any>);
};

// template-level `t` resolves to the global `%key%` mock from jest.setup.js
const CP = '%capa.clusterConfig.network.additionalControlPlaneIngressRules.ruleSectionTitlePrefix%';
const NODE = '%capa.clusterConfig.network.additionalNodeIngressRules.ruleSectionTitlePrefix%';
const CNI = '%capa.clusterConfig.network.cniIngressRules.ruleSectionTitlePrefix%';

// info banners explaining which rule lists are hidden by security group overrides
const overrideBanners = (wrapper: ReturnType<typeof createWrapper>) => wrapper.findAll('.banner-stub[data-color="info"]').map((b) => b.text());

describe('component: Networking', () => {
  describe('network strategy', () => {
    it('should show the vpc cidr block input for a managed network', () => {
      const cidrValidators = [jest.fn()];
      const wrapper = createWrapper({ cidrBlock: '10.0.0.0/16', cidrBlockValidators: cidrValidators });
      const cidr = wrapper.findComponent(LabeledInput);

      expect(wrapper.findAllComponents(LabeledSelect)).toHaveLength(0);
      expect(cidr.props('value')).toBe('10.0.0.0/16');
      expect(cidr.props('rules')).toStrictEqual(cidrValidators);
      expect(cidr.props('disabled')).toBe(false);
      expect(wrapper.findComponent(SecurityOverrides).exists()).toBe(false);

      cidr.vm.$emit('update:value', '10.1.0.0/16');

      expect(wrapper.emitted('update:cidrBlock')).toStrictEqual([['10.1.0.0/16']]);
    });

    it('should show the vpc and subnet selects for an unmanaged network', () => {
      const vpcValidators = [jest.fn()];
      const subnetValidators = [jest.fn()];
      const wrapper = createWrapper({
        useUnmanagedNetwork: true, vpcInfo: VPCS, subnetInfo: SUBNETS, vpcValidators, subnetValidators
      });
      const [vpc, subnet] = wrapper.findAllComponents(LabeledSelect);

      expect(wrapper.findComponent(LabeledInput).exists()).toBe(false);
      expect(vpc.props('options')).toStrictEqual([
        { label: 'capa-made (vpc-capa)', value: 'vpc-capa' },
        { label: 'my-vpc (vpc-user)', value: 'vpc-user' },
        { label: 'vpc-untagged', value: 'vpc-untagged' },
      ]);
      expect(vpc.props('rules')).toStrictEqual(vpcValidators);
      expect(subnet.props('rules')).toStrictEqual(subnetValidators);
      expect(subnet.attributes('multiple')).toBe('true');
      // every subnet is offered until a vpc is picked
      expect(subnet.props('options')).toHaveLength(3);
      expect(wrapper.findComponent(SecurityOverrides).exists()).toBe(true);
    });

    it('should only offer subnets from the selected vpc', () => {
      const wrapper = createWrapper({
        useUnmanagedNetwork: true, vpcId: 'vpc-user', vpcInfo: VPCS, subnetInfo: SUBNETS
      });

      expect(wrapper.findAllComponents(LabeledSelect)[1].props('options')).toStrictEqual([
        { label: 'private-b (subnet-b)', value: 'subnet-b' },
        { label: 'private-a (subnet-a)', value: 'subnet-a' },
      ]);
    });

    it('should emit the selected vpc and subnets', () => {
      const wrapper = createWrapper({ useUnmanagedNetwork: true, subnets: [{ id: 'subnet-a' }] });
      const [vpc, subnet] = wrapper.findAllComponents(LabeledSelect);

      expect(subnet.props('value')).toStrictEqual(['subnet-a']);

      vpc.vm.$emit('update:value', 'vpc-user');
      subnet.vm.$emit('update:value', ['subnet-a', 'subnet-b']);

      expect(wrapper.emitted('update:vpcId')).toStrictEqual([['vpc-user']]);
      expect(wrapper.emitted('update:subnets')).toStrictEqual([[[{ id: 'subnet-a' }, { id: 'subnet-b' }]]]);
    });

    it('should clear the vpc and subnets when the user switches back to a managed network', () => {
      const wrapper = createWrapper({ useUnmanagedNetwork: true, vpcId: 'vpc-user' });

      wrapper.findComponent(RadioGroup).vm.$emit('update:value', false);

      expect(wrapper.emitted('update:vpcId')).toStrictEqual([[null]]);
      expect(wrapper.emitted('update:subnets')).toStrictEqual([[null]]);
      expect(wrapper.emitted('update:useUnmanagedNetwork')).toStrictEqual([[false]]);
    });

    it('should not clear anything when the user switches to an unmanaged network', () => {
      const wrapper = createWrapper();

      wrapper.findComponent(RadioGroup).vm.$emit('update:value', true);

      expect(wrapper.emitted('update:vpcId')).toBeUndefined();
      expect(wrapper.emitted('update:useUnmanagedNetwork')).toStrictEqual([[true]]);
    });

    it.each([
      [_CREATE, false],
      [_EDIT, true],
      [_VIEW, true],
    ])('should only allow changing the strategy, vpc and cidr block on create (%p)', (mode, disabled) => {
      const managed = createWrapper({ mode });
      const unmanaged = createWrapper({ mode, useUnmanagedNetwork: true });

      expect(managed.findComponent(RadioGroup).props('disabled')).toBe(disabled);
      expect(managed.findComponent(LabeledInput).props('disabled')).toBe(disabled);
      expect(unmanaged.findAllComponents(LabeledSelect)[0].props('disabled')).toBe(disabled);
    });

    it.each([
      ['a vpc created by CAPA', 'vpc-capa', false],
      ['a user-provided vpc', 'vpc-user', true],
    ])('should detect the network strategy from %s once vpcs load', async(_, vpcId, unmanaged) => {
      const wrapper = createWrapper({ vpcId, mode: _EDIT });

      await wrapper.setProps({ vpcInfo: VPCS });

      expect(wrapper.emitted('update:useUnmanagedNetwork')).toStrictEqual([[unmanaged]]);
    });

    it('should not guess the network strategy without a vpc', async() => {
      const wrapper = createWrapper({ mode: _EDIT });

      await wrapper.setProps({ vpcInfo: VPCS });

      expect(wrapper.emitted('update:useUnmanagedNetwork')).toBeUndefined();
    });
  });

  it.each([
    [true, {}],
    [false, undefined],
  ])('should emit the ipv6 config when ipv6 is set to %p', (enabled, expected) => {
    const wrapper = createWrapper();
    const checkbox = wrapper.findComponent(Checkbox);

    expect(checkbox.props('value')).toBe(false);

    checkbox.vm.$emit('update:value', enabled);

    expect(wrapper.emitted('update:ipv6')).toStrictEqual([[expected]]);
  });

  it('should show ipv6 as enabled when an ipv6 block is configured', () => {
    expect(createWrapper({ ipv6: {} }).findComponent(Checkbox).props('value')).toBe(true);
  });

  it('should reset the subnets and drop security group sources when the vpc changes', async() => {
    const wrapper = createWrapper({
      vpcId:                              'vpc-user',
      additionalControlPlaneIngressRules: [{
        protocol: 'tcp', sourceSecurityGroupIDs: ['sg-1'], sourceSecurityGroupRoles: ['node']
      }],
      additionalNodeIngressRules: [{ protocol: 'udp', cidrBlocks: ['10.0.0.0/8'] }],
    });

    await wrapper.setProps({ vpcId: 'vpc-capa' });

    expect(wrapper.emitted('update:subnets')).toStrictEqual([[[]]]);
    expect(wrapper.emitted('update:additionalControlPlaneIngressRules')).toStrictEqual([[[{ protocol: 'tcp', sourceSecurityGroupRoles: ['node'] }]]]);
    expect(wrapper.emitted('update:additionalNodeIngressRules')).toStrictEqual([[[{ protocol: 'udp', cidrBlocks: ['10.0.0.0/8'] }]]]);
  });

  describe('ingress rules', () => {
    it('should render the three rule lists and forward their updates', () => {
      const cpRules = [{ protocol: 'tcp' }];
      const cpValidators = [jest.fn()];
      const wrapper = createWrapper({
        additionalControlPlaneIngressRules: cpRules, additionalControlPlaneIngressRulesValidators: cpValidators, vpcId: 'vpc-user'
      });
      const lists = ingressRules(wrapper);

      expect(Object.keys(lists)).toStrictEqual([CP, NODE, CNI]);
      expect(lists[CP].props('value')).toStrictEqual(cpRules);
      expect(lists[CP].props('vpcId')).toBe('vpc-user');
      expect(lists[CNI].props('allowTargets')).toBe(false);

      lists[CP].vm.$emit('update:value', [{ protocol: 'udp' }]);
      lists[NODE].vm.$emit('update:value', [{ protocol: 'icmp' }]);
      lists[CNI].vm.$emit('update:value', [{ protocol: '-1' }]);

      expect(wrapper.emitted('update:additionalControlPlaneIngressRules')).toStrictEqual([[[{ protocol: 'udp' }]]]);
      expect(wrapper.emitted('update:additionalNodeIngressRules')).toStrictEqual([[[{ protocol: 'icmp' }]]]);
      expect(wrapper.emitted('update:cniIngressRules')?.pop()).toStrictEqual([[{ protocol: '-1' }]]);
    });

    it('should forward security group override updates', () => {
      const wrapper = createWrapper({ useUnmanagedNetwork: true });

      wrapper.findComponent(SecurityOverrides).vm.$emit('update:value', { node: 'sg-1' });

      expect(wrapper.emitted('update:securityGroupOverrides')).toStrictEqual([[{ node: 'sg-1' }]]);
    });

    it('should hide and stash control plane rules while the control plane security group is overridden', async() => {
      const cpRules = [{
        protocol: 'tcp', fromPort: 1, toPort: 1
      }];
      const wrapper = createWrapper({ useUnmanagedNetwork: true, additionalControlPlaneIngressRules: cpRules });

      await wrapper.setProps({ securityGroupOverrides: { controlplane: 'sg-1' } });

      expect(ingressRules(wrapper)[CP]).toBeUndefined();
      expect(ingressRules(wrapper)[CNI]).toBeDefined();
      expect(overrideBanners(wrapper)).toStrictEqual([
        '%capa.clusterConfig.network.overrideBanners.controlPlaneOverridden%',
        '%capa.clusterConfig.network.overrideBanners.controlPlaneOverriddenCni%',
      ]);
      expect(wrapper.emitted('update:additionalControlPlaneIngressRules')).toStrictEqual([[[]]]);

      // the parent clears the rules in response
      await wrapper.setProps({ additionalControlPlaneIngressRules: [], securityGroupOverrides: {} });

      expect(wrapper.emitted('update:additionalControlPlaneIngressRules')?.[1]).toStrictEqual([cpRules]);
    });

    it('should hide and stash node rules while the node security group is overridden', async() => {
      const nodeRules = [{
        protocol: 'udp', fromPort: 2, toPort: 2
      }];
      const wrapper = createWrapper({ useUnmanagedNetwork: true, additionalNodeIngressRules: nodeRules });

      await wrapper.setProps({ securityGroupOverrides: { node: 'sg-1' } });

      expect(ingressRules(wrapper)[NODE]).toBeUndefined();
      expect(overrideBanners(wrapper)).toStrictEqual([
        '%capa.clusterConfig.network.overrideBanners.nodeOverridden%',
        '%capa.clusterConfig.network.overrideBanners.nodeOverriddenCni%',
      ]);
      expect(wrapper.emitted('update:additionalNodeIngressRules')).toStrictEqual([[[]]]);

      await wrapper.setProps({ additionalNodeIngressRules: [], securityGroupOverrides: { node: '' } });

      expect(wrapper.emitted('update:additionalNodeIngressRules')?.[1]).toStrictEqual([nodeRules]);
    });

    it('should hide and stash cni rules while both the node and control plane security groups are overridden', async() => {
      const cniRules = [{
        protocol: 'udp', fromPort: 9, toPort: 9
      }];
      const wrapper = createWrapper({ useUnmanagedNetwork: true, cniIngressRules: cniRules });

      await wrapper.setProps({ securityGroupOverrides: { node: 'sg-1', controlplane: 'sg-2' } });

      expect(Object.keys(ingressRules(wrapper))).toStrictEqual([]);
      expect(overrideBanners(wrapper)).toContain('%capa.clusterConfig.network.overrideBanners.bothOverridden%');
      expect(wrapper.emitted('update:cniIngressRules')?.pop()).toStrictEqual([[]]);

      await wrapper.setProps({ cniIngressRules: [], securityGroupOverrides: { node: 'sg-1' } });

      expect(wrapper.emitted('update:cniIngressRules')?.pop()).toStrictEqual([cniRules]);
    });
  });

  describe('cni ingress rules', () => {
    const provisioningCluster = (cni?: string) => ({ spec: { rkeConfig: { machineGlobalConfig: { cni } } } });

    it.each(Object.keys(CNI_INGRESS_RULES))('should add the default %p rules', (cni) => {
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster(cni) });

      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[(CNI_INGRESS_RULES as Record<string, unknown>)[cni]]]);
    });

    it('should use the rules of the CNI paired with multus', () => {
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('multus,canal') });

      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[CNI_INGRESS_RULES.canal]]);
    });

    it('should not emit for an unknown or missing CNI', () => {
      expect(createWrapper({ provisioningCluster: provisioningCluster('none') }).emitted('update:cniIngressRules')).toBeUndefined();
      expect(createWrapper().emitted('update:cniIngressRules')).toBeUndefined();
    });

    it('should not emit when the rules would not change', () => {
      const userRule = {
        protocol: 'tcp', fromPort: 1234, toPort: 1234
      } as const;

      expect(createWrapper({ provisioningCluster: provisioningCluster('none'), cniIngressRules: [userRule] }).emitted('update:cniIngressRules')).toBeUndefined();
    });

    it.each(Object.keys(CNI_INGRESS_RULES))('should be idempotent when mounted again with the %p rules already present', (cni) => {
      const presets = (CNI_INGRESS_RULES as Record<string, any[]>)[cni];
      const userRule = {
        protocol: 'tcp', fromPort: 1234, toPort: 1234
      } as const;

      // e.g. editing a cluster, or the networking section being re-rendered
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster(cni), cniIngressRules: [userRule, ...presets] });

      expect(wrapper.emitted('update:cniIngressRules')).toBeUndefined();
    });

    it('should drop duplicate rules', () => {
      const [vxlan, typha] = CNI_INGRESS_RULES.calico;
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('calico'), cniIngressRules: [vxlan, typha, { ...vxlan }] });

      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[[vxlan, typha]]]);
    });

    it('should not add a preset rule when a custom rule already uses the same protocol and ports', () => {
      const customVxlan = {
        description: 'my vxlan', protocol: 'udp', fromPort: 4789, toPort: 4789
      } as const;
      const [, typha] = CNI_INGRESS_RULES.calico;

      expect(createWrapper({ provisioningCluster: provisioningCluster('flannel'), cniIngressRules: [customVxlan] }).emitted('update:cniIngressRules')).toBeUndefined();

      // only the calico rule that has no equivalent is added
      expect(createWrapper({ provisioningCluster: provisioningCluster('calico'), cniIngressRules: [customVxlan] }).emitted('update:cniIngressRules')).toStrictEqual([[[customVxlan, typha]]]);
    });

    it('should still add a preset rule when only the protocol or ports match', () => {
      const [flannelVxlan] = CNI_INGRESS_RULES.flannel;
      const tcpSamePorts = { ...flannelVxlan, protocol: 'tcp' } as const;
      const udpOtherPort = { ...flannelVxlan, toPort: 4790 };
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('flannel'), cniIngressRules: [tcpSamePorts, udpOtherPort] });

      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[[tcpSamePorts, udpOtherPort, flannelVxlan]]]);
    });

    it('should keep an edited preset rule, and not add the new preset on the same ports, when the CNI changes', async() => {
      const [calicoVxlan, calicoTypha] = CNI_INGRESS_RULES.calico;
      const editedVxlan = { ...calicoVxlan, description: 'edited' };
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('calico'), cniIngressRules: [editedVxlan, calicoTypha] });

      expect(wrapper.emitted('update:cniIngressRules')).toBeUndefined();

      await wrapper.setProps({ provisioningCluster: provisioningCluster('flannel') });

      // the untouched calico preset is removed; flannel's VXLAN rule uses the same permission as the edited one
      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[[editedVxlan]]]);
    });

    it('should replace presets that share ports when switching CNI', async() => {
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('calico'), cniIngressRules: CNI_INGRESS_RULES.calico });

      await wrapper.setProps({ provisioningCluster: provisioningCluster('flannel') });

      expect(wrapper.emitted('update:cniIngressRules')).toStrictEqual([[CNI_INGRESS_RULES.flannel]]);
    });

    it('should swap the old CNI rules for the new ones and keep user rules', async() => {
      const userRule = {
        protocol: 'tcp', fromPort: 1234, toPort: 1234
      } as const;
      const wrapper = createWrapper({ provisioningCluster: provisioningCluster('calico'), cniIngressRules: [...CNI_INGRESS_RULES.calico, userRule] });

      await wrapper.setProps({ provisioningCluster: provisioningCluster('cilium') });

      expect(wrapper.emitted('update:cniIngressRules')?.pop()).toStrictEqual([[userRule, ...CNI_INGRESS_RULES.cilium]]);
    });

    it('should update the stashed rules while cni rules are hidden', async() => {
      const wrapper = createWrapper({
        useUnmanagedNetwork:    true,
        provisioningCluster:    provisioningCluster('flannel'),
        cniIngressRules:        CNI_INGRESS_RULES.flannel,
        securityGroupOverrides: { node: 'sg-1', controlplane: 'sg-2' },
      });

      // hidden from the start, so the cni rules are not stashed by the override watcher
      await wrapper.setProps({ provisioningCluster: provisioningCluster('canal') });
      const emittedWhileHidden = wrapper.emitted('update:cniIngressRules')?.length;

      await wrapper.setProps({ securityGroupOverrides: {} });
      await nextTick();

      expect(wrapper.emitted('update:cniIngressRules')).toHaveLength((emittedWhileHidden || 0) + 1);
      expect(wrapper.emitted('update:cniIngressRules')?.pop()).toStrictEqual([CNI_INGRESS_RULES.canal]);
    });
  });
});
