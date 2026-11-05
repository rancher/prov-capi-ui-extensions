import { nextTick } from 'vue';
import { shallowMount, VueWrapper } from '@vue/test-utils';
import { _CREATE, _VIEW } from '@shell/config/query-params';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import UnitInput from '@shell/components/form/UnitInput.vue';
import KeyValue from '@shell/components/form/KeyValue.vue';
import { Checkbox } from '@components/Form/Checkbox';
import { RadioGroup } from '@components/Form/Radio';
import AdvancedSection from '../AdvancedSection.vue';
import { SECURITY_GROUPS } from '../../__tests__/fixtures/aws';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable', 'expanded'],
  template: '<section><slot /></section>',
};

const createWrapper = (props: Record<string, any> = {}): VueWrapper<any> => shallowMount(AdvancedSection, {
  props,
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { RcSection: RcSectionStub },
  },
});

const fields = (wrapper: ReturnType<typeof createWrapper>) => ({
  cloudInit:      wrapper.findComponent(Checkbox),
  securityGroups: wrapper.findComponent(LabeledSelect),
  marketType:     wrapper.findComponent(RadioGroup),
  spotPrice:      wrapper.findComponent(UnitInput),
  tags:           wrapper.findComponent(KeyValue),
});

describe('component: AdvancedSection', () => {
  it('should show the defaults', () => {
    const {
      cloudInit, securityGroups, marketType, spotPrice, tags
    } = fields(createWrapper());

    expect(cloudInit.props('value')).toBe(true);
    expect(securityGroups.props('value')).toStrictEqual([]);
    expect(marketType.props('value')).toBe('OnDemand');
    expect(spotPrice.exists()).toBe(false);
    expect(tags.props('value')).toStrictEqual({});
  });

  it('should offer the on-demand, spot and capacity block market types', () => {
    const { marketType } = fields(createWrapper());

    expect((marketType.props('options') as any[]).map((o) => o.value)).toStrictEqual(['OnDemand', 'Spot', 'CapacityBlock']);
  });

  describe('security groups', () => {
    it('should be disabled until the cluster has a vpc', () => {
      const { securityGroups } = fields(createWrapper({ securityGroups: SECURITY_GROUPS }));

      expect(securityGroups.props('disabled')).toBe(true);
    });

    it('should offer the vpc security groups sorted by label', () => {
      const { securityGroups } = fields(createWrapper({
        securityGroups: [...SECURITY_GROUPS, { GroupId: 'sg-0', VpcId: 'vpc-user' }], vpcId: 'vpc-user', loadingSecurityGroups: true
      }));

      expect(securityGroups.props('disabled')).toBe(false);
      expect(securityGroups.props('loading')).toBe(true);
      expect(securityGroups.props('options')).toStrictEqual([
        { label: 'default (sg-1)', value: 'sg-1' },
        { label: 'sg-0', value: 'sg-0' },
        { label: 'web (sg-2)', value: 'sg-2' },
      ]);
    });

    it('should convert between ids and security group references', () => {
      const wrapper = createWrapper({ additionalSecurityGroups: [{ id: 'sg-1' }], vpcId: 'vpc-user' });
      const { securityGroups } = fields(wrapper);

      expect(securityGroups.props('value')).toStrictEqual(['sg-1']);

      securityGroups.vm.$emit('update:value', ['sg-1', 'sg-2']);
      securityGroups.vm.$emit('update:value', null);

      expect(wrapper.emitted('update:additionalSecurityGroups')).toStrictEqual([
        [[{ id: 'sg-1' }, { id: 'sg-2' }]],
        [[]],
      ]);
    });
  });

  describe('market type', () => {
    it('should emit the selected market type', () => {
      const wrapper = createWrapper();

      fields(wrapper).marketType.vm.$emit('update:value', 'Spot');

      expect(wrapper.emitted('update:marketType')).toStrictEqual([['Spot']]);
    });

    it('should show the spot price only for spot instances', () => {
      const { spotPrice } = fields(createWrapper({ marketType: 'Spot', spotMarketMaxPrice: '0.05' }));

      expect(spotPrice.props('value')).toBe('0.05');
    });

    it.each([
      [0.12, '0.12'],
      ['0.3', '0.3'],
      ['', undefined],
      [null, undefined],
    ])('should emit the spot price %p as %p', (input, expected) => {
      const wrapper = createWrapper({ marketType: 'Spot' });

      fields(wrapper).spotPrice.vm.$emit('update:value', input);

      expect(wrapper.emitted('update:spotMarketMaxPrice')).toStrictEqual([[expected]]);
    });

    it('should clear the spot price when leaving spot', async() => {
      const wrapper = createWrapper({ marketType: 'Spot', spotMarketMaxPrice: '0.05' });

      await wrapper.setProps({ marketType: 'CapacityBlock' });
      await nextTick();

      expect(wrapper.emitted('update:spotMarketMaxPrice')).toStrictEqual([[undefined]]);
      expect(fields(wrapper).spotPrice.exists()).toBe(false);
    });

    it('should keep the spot price when switching to spot', async() => {
      const wrapper = createWrapper();

      await wrapper.setProps({ marketType: 'Spot' });

      expect(wrapper.emitted('update:spotMarketMaxPrice')).toBeUndefined();
    });
  });

  it('should emit cloud init and tag changes', () => {
    const wrapper = createWrapper();
    const { cloudInit, tags } = fields(wrapper);

    cloudInit.vm.$emit('update:value', false);
    tags.vm.$emit('update:value', { team: 'capi' });

    expect(wrapper.emitted('update:cloudInitInsecureSkipSecretsManager')).toStrictEqual([[false]]);
    expect(wrapper.emitted('update:additionalTags')).toStrictEqual([[{ team: 'capi' }]]);
  });

  it.each([_CREATE, _VIEW])('should pass the %p mode down', (mode) => {
    const {
      cloudInit, securityGroups, marketType, tags
    } = fields(createWrapper({ mode }));

    [cloudInit, securityGroups, marketType, tags].forEach((field) => {
      expect(field.props('mode')).toBe(mode);
    });
  });
});
