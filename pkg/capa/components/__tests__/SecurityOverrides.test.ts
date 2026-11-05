import { nextTick } from 'vue';
import { shallowMount, VueWrapper } from '@vue/test-utils';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import ButtonDropdown from '@shell/components/ButtonDropdown.vue';
import SecurityOverrides from '../SecurityOverrides.vue';

// Renders the key/value slots for every entry so the per-role inputs can be inspected.
const KeyValueStub = {
  name:     'KeyValue',
  props:    ['value', 'mode', 'addAllowed', 'readAllowed', 'keyLabel', 'valueLabel'],
  template: `<div class="kv">
    <div v-for="(v, k) in value" :key="k" class="kv-row">
      <slot name="key" :row="{ key: k, value: v }" />
      <slot name="value" :row="{ key: k, value: v }" />
    </div>
  </div>`,
};

const SECURITY_GROUPS = [
  {
    GroupId: 'sg-1', GroupName: 'one', Description: 'first', VpcId: 'vpc-a'
  },
  {
    GroupId: 'sg-2', GroupName: 'two', Description: 'second', VpcId: 'vpc-a'
  },
  {
    GroupId: 'sg-3', GroupName: 'three', Description: 'third', VpcId: 'vpc-b'
  },
];

const createWrapper = (props: Record<string, any> = {}): VueWrapper<any> => shallowMount(SecurityOverrides, {
  props: {
    vpcId: 'vpc-a', value: {}, securityGroupInfo: SECURITY_GROUPS, ...props
  },
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { KeyValue: KeyValueStub },
  },
});

const lastEmitted = (wrapper: ReturnType<typeof createWrapper>) => {
  const events = wrapper.emitted('update:value') || [];

  return events[events.length - 1]?.[0];
};

describe('component: SecurityOverrides', () => {
  it('should only show the add-override dropdown when there are no overrides', () => {
    const wrapper = createWrapper();
    const dropdown = wrapper.findComponent(ButtonDropdown);

    expect(wrapper.findComponent(KeyValueStub).exists()).toBe(false);
    expect((dropdown.props('dropdownOptions') as any[]).map((o) => o.value)).toStrictEqual(['node', 'controlplane', 'apiserver-lb', 'lb']);
  });

  it('should list existing overrides and exclude their roles from the dropdown', () => {
    const wrapper = createWrapper({ value: { node: 'sg-1', controlplane: 'sg-2' } });

    const roleInputs = wrapper.findAllComponents(LabeledInput);

    expect(roleInputs.map((i) => i.props('value'))).toStrictEqual([
      'capa.clusterConfig.network.securityGroups.roles.node',
      'capa.clusterConfig.network.securityGroups.roles.controlplane',
    ]);
    expect((wrapper.findComponent(ButtonDropdown).props('dropdownOptions') as any[]).map((o) => o.value)).toStrictEqual(['apiserver-lb', 'lb']);
  });

  it('should still offer a role whose override has no security group yet', () => {
    const wrapper = createWrapper({ value: { node: '' } });

    expect((wrapper.findComponent(ButtonDropdown).props('dropdownOptions') as any[]).map((o) => o.value)).toContain('node');
  });

  it('should hide the dropdown once every role is overridden', () => {
    const wrapper = createWrapper({
      value: {
        node: 'sg-1', controlplane: 'sg-1', 'apiserver-lb': 'sg-1', lb: 'sg-1'
      }
    });

    expect(wrapper.findComponent(ButtonDropdown).exists()).toBe(false);
  });

  it('should only offer security groups from the selected VPC', () => {
    const wrapper = createWrapper({ value: { node: 'sg-1' } });
    const select = wrapper.findComponent(LabeledSelect);

    expect(select.props('options')).toStrictEqual([
      { label: 'one (first)', value: 'sg-1' },
      { label: 'two (second)', value: 'sg-2' },
    ]);
    expect(select.props('disabled')).toBe(false);
  });

  it('should disable the security group select until a VPC is selected', () => {
    const wrapper = createWrapper({ vpcId: '', value: { node: '' } });
    const select = wrapper.findComponent(LabeledSelect);

    expect(select.props('options')).toStrictEqual([]);
    expect(select.props('disabled')).toBe(true);
    expect(select.props('placeholder')).toBe('%capa.clusterConfig.network.securityGroups.selectVpc%');
  });

  it('should add an override defaulting to the first security group in the VPC', async() => {
    const wrapper = createWrapper({ value: { node: 'sg-2' } });

    wrapper.findComponent(ButtonDropdown).vm.$emit('click-action', { value: 'lb' });
    await nextTick();

    expect(lastEmitted(wrapper)).toStrictEqual({ node: 'sg-2', lb: 'sg-1' });
  });

  it('should add an empty override when there is no VPC', async() => {
    const wrapper = createWrapper({ vpcId: '' });

    wrapper.findComponent(ButtonDropdown).vm.$emit('click-action', { value: 'node' });
    await nextTick();

    expect(lastEmitted(wrapper)).toStrictEqual({ node: '' });
  });

  it('should update the security group of an override', async() => {
    const wrapper = createWrapper({ value: { node: 'sg-1', lb: 'sg-1' } });

    wrapper.findAllComponents(LabeledSelect)[1].vm.$emit('update:value', 'sg-2');
    await nextTick();

    expect(lastEmitted(wrapper)).toStrictEqual({ node: 'sg-1', lb: 'sg-2' });
  });

  it('should emit when overrides are removed through the key/value list', async() => {
    const wrapper = createWrapper({ value: { node: 'sg-1', lb: 'sg-1' } });

    wrapper.findComponent(KeyValueStub).vm.$emit('update:value', { node: 'sg-1' });
    await nextTick();

    expect(lastEmitted(wrapper)).toStrictEqual({ node: 'sg-1' });
  });

  it('should clear the selected security groups when the VPC changes', async() => {
    const wrapper = createWrapper({ value: { node: 'sg-1', lb: 'sg-2' } });

    await wrapper.setProps({ vpcId: 'vpc-b' });

    expect(lastEmitted(wrapper)).toStrictEqual({ node: '', lb: '' });
  });

  it('should keep the selected security groups when the first VPC is chosen', async() => {
    const wrapper = createWrapper({ vpcId: '', value: { node: '' } });

    await wrapper.setProps({ vpcId: 'vpc-a' });

    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('should follow value changes from the parent without echoing them back', async() => {
    const wrapper = createWrapper({ value: { node: 'sg-1' } });

    await wrapper.setProps({ value: { controlplane: 'sg-2' } });
    await nextTick();

    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.findComponent(KeyValueStub).props('value')).toStrictEqual({ controlplane: 'sg-2' });

    // user changes after the prop update are emitted again
    wrapper.findComponent(LabeledSelect).vm.$emit('update:value', 'sg-1');
    await nextTick();

    expect(lastEmitted(wrapper)).toStrictEqual({ controlplane: 'sg-1' });
  });
});
