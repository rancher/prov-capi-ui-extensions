import { shallowMount } from '@vue/test-utils';
import { _CREATE, _VIEW } from '@shell/config/query-params';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import Checkbox from '@components/Form/Checkbox/Checkbox.vue';
import RcSectionActions from '@components/RcSection/RcSectionActions.vue';
import IngressRules from '../IngressRules.vue';
import type { IngressRule } from '../../types/capa';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable'],
  template: '<section :data-title="title"><slot name="actions" /><slot /></section>',
};

const SECURITY_GROUPS = [
  {
    GroupId: 'sg-1', GroupName: 'one', VpcId: 'vpc-a'
  },
  {
    GroupId: 'sg-2', GroupName: 'two', VpcId: 'vpc-b'
  },
];

const createWrapper = (props: Record<string, any> = {}) => shallowMount(IngressRules, {
  props:  { value: [], ...props },
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { RcSection: RcSectionStub },
  },
});

/**
 * Inputs of a rule with targets, in template order: description, fromPort, toPort, cidrBlocks, ipv6CidrBlocks.
 * Selects: protocol, sourceSecurityGroupIDs, sourceSecurityGroupRoles.
 */
const ruleInputs = (wrapper: ReturnType<typeof createWrapper>) => {
  const inputs = wrapper.findAllComponents(LabeledInput);
  const selects = wrapper.findAllComponents(LabeledSelect);

  return {
    description:      inputs[0],
    fromPort:         inputs[1],
    toPort:           inputs[2],
    cidrBlocks:       inputs[3],
    ipv6CidrBlocks:   inputs[4],
    protocol:         selects[0],
    securityGroups:   selects[1],
    securityRoles:    selects[2],
    natGatewaySource: wrapper.findComponent(Checkbox),
  };
};

const lastEmitted = (wrapper: ReturnType<typeof createWrapper>): any => {
  const events = wrapper.emitted('update:value') || [];

  return events[events.length - 1]?.[0];
};

describe('component: IngressRules', () => {
  it('should render a titled section per rule', () => {
    const wrapper = createWrapper({ value: [{ protocol: 'tcp' }, { protocol: 'udp' }], titlePrefix: 'Node' });
    const sections = wrapper.findAll('section');

    expect(sections).toHaveLength(2);
    // template-level `t` resolves to the global `%key%` mock from jest.setup.js
    expect(sections[1].attributes('data-title')).toBe('%capa.clusterConfig.network.ingressRules.ruleTitle%');
  });

  it('should render untitled sections without a title prefix', () => {
    const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });

    expect(wrapper.find('section').attributes('data-title')).toBe('');
  });

  describe('adding and removing rules', () => {
    it('should add a rule with empty targets', async() => {
      const existing: IngressRule = {
        protocol: 'udp', fromPort: 1, toPort: 2
      };
      const wrapper = createWrapper({ value: [existing] });

      await wrapper.find('button').trigger('click');

      expect(lastEmitted(wrapper)).toStrictEqual([
        existing,
        {
          description: '', protocol: 'tcp', cidrBlocks: [], sourceSecurityGroupIDs: [], sourceSecurityGroupRoles: []
        },
      ]);
    });

    it('should add a rule without target fields when targets are not allowed', async() => {
      const wrapper = createWrapper({ allowTargets: false });

      await wrapper.find('button').trigger('click');

      expect(lastEmitted(wrapper)).toStrictEqual([{ description: '', protocol: 'tcp' }]);
    });

    it('should disable adding rules when requested', () => {
      const wrapper = createWrapper({ disableAdd: true });

      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('should not offer to add rules in view mode', () => {
      const wrapper = createWrapper({ mode: _VIEW, value: [{ protocol: 'tcp' }] });

      expect(wrapper.find('button').exists()).toBe(false);
    });

    it('should remove a rule through its section action', () => {
      const rules: IngressRule[] = [{ protocol: 'tcp', description: 'a' }, { protocol: 'udp', description: 'b' }];
      const wrapper = createWrapper({ value: rules });
      const actions = wrapper.findAllComponents(RcSectionActions)[0].props('actions') as any[];

      expect(actions).toHaveLength(1);
      expect(actions[0].icon).toBe('trash');

      actions[0].action();

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'udp', description: 'b' }]);
    });
  });

  describe('editing a rule', () => {
    it('should update the description', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp', description: '' }] });

      ruleInputs(wrapper).description.vm.$emit('update:value', 'SSH');

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'tcp', description: 'SSH' }]);
    });

    it('should update the protocol', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });
      const { protocol } = ruleInputs(wrapper);

      expect((protocol.props('options') as any[]).map((o) => o.value)).toStrictEqual(['-1', 'tcp', 'udp', 'icmp', '58', '4', '50']);

      protocol.vm.$emit('update:value', 'udp');

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'udp' }]);
    });

    it.each([
      ['22', 22],
      ['8080abc', 8080],
      ['abc', 0],
      ['', 0],
    ])('should parse the port %p as %p', (input, expected) => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });
      const { fromPort, toPort } = ruleInputs(wrapper);

      fromPort.vm.$emit('update:value', input);
      expect(lastEmitted(wrapper)[0].fromPort).toBe(expected);

      toPort.vm.$emit('update:value', input);
      expect(lastEmitted(wrapper)[0].toPort).toBe(expected);
    });

    it('should drop empty target lists from the rule', () => {
      const wrapper = createWrapper({
        value: [{
          protocol: 'tcp', sourceSecurityGroupRoles: ['node'], cidrBlocks: []
        }]
      });

      ruleInputs(wrapper).securityRoles.vm.$emit('update:value', []);

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'tcp' }]);
    });

    it('should only offer security groups from the selected VPC', () => {
      const wrapper = createWrapper({
        value: [{ protocol: 'tcp' }], vpcId: 'vpc-a', securityGroupInfo: SECURITY_GROUPS
      });

      expect(ruleInputs(wrapper).securityGroups.props('options')).toStrictEqual([{ label: 'one (sg-1)', value: 'sg-1' }]);
    });

    it('should offer every security group when no VPC is selected', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }], securityGroupInfo: SECURITY_GROUPS });

      expect(ruleInputs(wrapper).securityGroups.props('options')).toHaveLength(2);
    });

    it('should offer the security group roles', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });

      expect((ruleInputs(wrapper).securityRoles.props('options') as any[]).map((o) => o.value)).toStrictEqual(['node', 'controlplane', 'apiserver-lb', 'lb']);
    });
  });

  describe('cidr blocks', () => {
    it('should keep the raw text while typing and only parse it on blur', async() => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });
      const { cidrBlocks } = ruleInputs(wrapper);

      cidrBlocks.vm.$emit('update:value', '10.0.0.0/16, ');
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:value')).toBeUndefined();
      expect(ruleInputs(wrapper).cidrBlocks.props('value')).toBe('10.0.0.0/16, ');

      cidrBlocks.vm.$emit('update:value', '10.0.0.0/16, 10.1.0.0/16,');
      cidrBlocks.vm.$emit('blur');

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'tcp', cidrBlocks: ['10.0.0.0/16', '10.1.0.0/16'] }]);
    });

    it('should parse ipv6 blocks on blur', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp', cidrBlocks: ['10.0.0.0/8'] }] });
      const { ipv6CidrBlocks } = ruleInputs(wrapper);

      ipv6CidrBlocks.vm.$emit('update:value', '::/0');
      ipv6CidrBlocks.vm.$emit('blur');

      expect(lastEmitted(wrapper)).toStrictEqual([{
        protocol: 'tcp', cidrBlocks: ['10.0.0.0/8'], ipv6CidrBlocks: ['::/0']
      }]);
    });

    it('should not emit on blur when nothing was typed', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });

      ruleInputs(wrapper).cidrBlocks.vm.$emit('blur');
      ruleInputs(wrapper).ipv6CidrBlocks.vm.$emit('blur');

      expect(wrapper.emitted('update:value')).toBeUndefined();
    });

    it('should show the existing blocks as a comma separated list', () => {
      const wrapper = createWrapper({
        value: [{
          protocol: 'tcp', cidrBlocks: ['10.0.0.0/8', '192.168.0.0/16'], ipv6CidrBlocks: ['::/0']
        }]
      });
      const { cidrBlocks, ipv6CidrBlocks } = ruleInputs(wrapper);

      expect(cidrBlocks.props('value')).toBe('10.0.0.0/8, 192.168.0.0/16');
      expect(ipv6CidrBlocks.props('value')).toBe('::/0');
    });

    it.each([
      ['10.0.0.0/8, 192.168.0.0/16', undefined],
      ['', undefined],
      ['10.0.0.0/8, nope', 'capa.errors.invalidIpv4Cidr'],
    ])('should validate the ipv4 text %p', (text, expected) => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });
      const [rule] = ruleInputs(wrapper).cidrBlocks.props('rules') as any[];

      expect(rule(text)).toStrictEqual(expected);
    });

    it.each([
      ['::/0, fd00::/8', undefined],
      ['10.0.0.0/8', 'capa.errors.invalidIpv6Cidr'],
    ])('should validate the ipv6 text %p', (text, expected) => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });
      const [rule] = ruleInputs(wrapper).ipv6CidrBlocks.props('rules') as any[];

      expect(rule(text)).toStrictEqual(expected);
    });
  });

  describe('mutually exclusive sources', () => {
    it.each([
      [
        'an empty rule with a vpc', { protocol: 'tcp' }, 'vpc-a',
        {
          cidr: false, groups: false, roles: false, nat: false
        }
      ],
      [
        'an empty rule without a vpc', { protocol: 'tcp' }, '',
        {
          cidr: false, groups: true, roles: false, nat: false
        }
      ],
      [
        'a rule with cidr blocks', { protocol: 'tcp', cidrBlocks: ['10.0.0.0/8'] }, 'vpc-a',
        {
          cidr: false, groups: true, roles: true, nat: true
        }
      ],
      [
        'a rule with ipv6 cidr blocks', { protocol: 'tcp', ipv6CidrBlocks: ['::/0'] }, 'vpc-a',
        {
          cidr: false, groups: true, roles: true, nat: true
        }
      ],
      [
        'a rule with security group roles', { protocol: 'tcp', sourceSecurityGroupRoles: ['node'] }, 'vpc-a',
        {
          cidr: true, groups: false, roles: false, nat: true
        }
      ],
      [
        'a rule with security groups', { protocol: 'tcp', sourceSecurityGroupIDs: ['sg-1'] }, 'vpc-a',
        {
          cidr: true, groups: false, roles: false, nat: true
        }
      ],
      [
        'a rule using the nat gateway ips', { protocol: 'tcp', natGatewaysIPsSource: true }, 'vpc-a',
        {
          cidr: true, groups: true, roles: true, nat: false
        }
      ],
    ])('should disable the right inputs for %s', (_, rule, vpcId, disabled) => {
      const wrapper = createWrapper({ value: [rule], vpcId });
      const inputs = ruleInputs(wrapper);

      expect(!!inputs.cidrBlocks.props('disabled')).toBe(disabled.cidr);
      expect(!!inputs.ipv6CidrBlocks.props('disabled')).toBe(disabled.cidr);
      expect(!!inputs.securityGroups.props('disabled')).toBe(disabled.groups);
      expect(!!inputs.securityRoles.props('disabled')).toBe(disabled.roles);
      expect(!!inputs.natGatewaySource.props('disabled')).toBe(disabled.nat);
    });

    it('should toggle the nat gateway source', () => {
      const wrapper = createWrapper({ value: [{ protocol: 'tcp' }] });

      ruleInputs(wrapper).natGatewaySource.vm.$emit('update:value', true);

      expect(lastEmitted(wrapper)).toStrictEqual([{ protocol: 'tcp', natGatewaysIPsSource: true }]);
    });
  });

  it('should hide every target field when targets are not allowed', () => {
    const wrapper = createWrapper({
      value: [{
        protocol: 'udp', fromPort: 4789, toPort: 4789
      }],
      allowTargets: false
    });

    // description, from and to port
    expect(wrapper.findAllComponents(LabeledInput)).toHaveLength(3);
    // protocol
    expect(wrapper.findAllComponents(LabeledSelect)).toHaveLength(1);
    expect(wrapper.findComponent(Checkbox).exists()).toBe(false);
  });

  it('should pass the mode down to every input', () => {
    const wrapper = createWrapper({ value: [{ protocol: 'tcp' }], mode: _CREATE });

    [...wrapper.findAllComponents(LabeledInput), ...wrapper.findAllComponents(LabeledSelect)].forEach((input) => {
      expect(input.props('mode')).toBe(_CREATE);
    });
  });
});
