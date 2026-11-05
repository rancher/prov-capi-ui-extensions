import { shallowMount } from '@vue/test-utils';
import { _CREATE, _EDIT } from '@shell/config/query-params';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import UnitInput from '@shell/components/form/UnitInput.vue';
import ArrayList from '@shell/components/form/ArrayList.vue';
import { Checkbox } from '@components/Form/Checkbox';
import StorageSection from '../StorageSection.vue';
import { NON_ROOT_VOLUME_DEFAULT, VOLUME_TYPES } from '../constants';
import { KMS_KEYS } from '../../__tests__/fixtures/aws';

const RcSectionStub = {
  name:     'RcSection',
  props:    ['title', 'type', 'mode', 'expandable', 'expanded'],
  template: '<section><slot /></section>',
};

const createWrapper = (props: Record<string, any> = {}) => shallowMount(StorageSection, {
  props,
  global: {
    provide: { store: { dispatch: jest.fn(), getters: {} } },
    stubs:   { RcSection: RcSectionStub },
  },
});

const fields = (wrapper: ReturnType<typeof createWrapper>) => {
  const [rootVolumeType, encryptionKey] = wrapper.findAllComponents(LabeledSelect);

  return {
    rootVolumeSize: wrapper.findComponent(UnitInput),
    rootVolumeType,
    encryptionKey,
    encrypted:      wrapper.findComponent(Checkbox),
    nonRootVolumes: wrapper.findComponent(ArrayList),
  };
};

describe('component: StorageSection', () => {
  it('should show the root volume defaults', () => {
    const {
      rootVolumeSize, rootVolumeType, encrypted, encryptionKey, nonRootVolumes
    } = fields(createWrapper());

    expect(rootVolumeSize.props('value')).toBe(32);
    expect(rootVolumeType.props('value')).toBe('gp3');
    expect(encrypted.props('value')).toBe(false);
    // the encryption key is only asked for when encryption is enabled
    expect(encryptionKey).toBeUndefined();
    expect(nonRootVolumes.props('value')).toStrictEqual([]);
  });

  it('should offer every EBS volume type', () => {
    const { rootVolumeType } = fields(createWrapper());

    expect((rootVolumeType.props('options') as any[]).map((o) => o.value)).toStrictEqual(VOLUME_TYPES);
  });

  it('should ask for a KMS key when the root volume is encrypted', () => {
    const rules = [jest.fn()];
    const { encryptionKey } = fields(createWrapper({
      rootVolumeEncrypted: true, rootVolumeEncryptionKey: 'key-2', kmsKeys: KMS_KEYS, loadingKmsKeys: true, rules: { rootVolumeEncryptionKey: rules }
    }));

    expect(encryptionKey.props('value')).toBe('key-2');
    expect(encryptionKey.props('options')).toStrictEqual([
      { label: 'arn:aws:kms:us-west-2:123:key/key-1', value: 'key-1' },
      { label: 'arn:aws:kms:us-west-2:123:key/key-2', value: 'key-2' },
    ]);
    expect(encryptionKey.props('loading')).toBe(true);
    expect(encryptionKey.props('rules')).toStrictEqual(rules);
  });

  it('should pass the root volume validation rules', () => {
    const sizeRules = [jest.fn()];
    const typeRules = [jest.fn()];
    const { rootVolumeSize, rootVolumeType } = fields(createWrapper({ rules: { rootVolumeSize: sizeRules, rootVolumeType: typeRules } }));

    // UnitInput has no `rules` prop of its own, it forwards it to its LabeledInput through $attrs
    expect(rootVolumeSize.vm.$attrs.rules).toStrictEqual(sizeRules);
    expect(rootVolumeType.props('rules')).toStrictEqual(typeRules);
  });

  it.each([
    ['rootVolumeSize', 'update:rootVolumeSize', 100],
    ['rootVolumeType', 'update:rootVolumeType', 'io2'],
    ['encrypted', 'update:rootVolumeEncrypted', true],
    ['nonRootVolumes', 'update:nonRootVolumes', [{
      deviceName: '/dev/sdb', type: 'gp3', size: 10
    }]],
  ])('should emit %p changes', (field, event, value) => {
    const wrapper = createWrapper();

    (fields(wrapper) as Record<string, any>)[field].vm.$emit('update:value', value);

    expect(wrapper.emitted(event)).toStrictEqual([[value]]);
  });

  it('should emit the selected KMS key', () => {
    const wrapper = createWrapper({ rootVolumeEncrypted: true, kmsKeys: KMS_KEYS });

    fields(wrapper).encryptionKey.vm.$emit('update:value', 'key-1');

    expect(wrapper.emitted('update:rootVolumeEncryptionKey')).toStrictEqual([['key-1']]);
  });

  it('should add additional volumes with the default volume settings', () => {
    const volumes = [{
      deviceName: '/dev/sdb', type: 'io1', size: 50
    }];
    const { nonRootVolumes } = fields(createWrapper({ nonRootVolumes: volumes }));

    expect(nonRootVolumes.props('value')).toStrictEqual(volumes);
    expect(nonRootVolumes.props('defaultAddValue')).toStrictEqual(NON_ROOT_VOLUME_DEFAULT);
    expect(NON_ROOT_VOLUME_DEFAULT).toStrictEqual({
      deviceName: '', type: 'gp3', size: null
    });
  });

  it.each([_CREATE, _EDIT])('should pass the %p mode down', (mode) => {
    const {
      rootVolumeSize, rootVolumeType, encrypted, nonRootVolumes
    } = fields(createWrapper({ mode }));

    [rootVolumeSize, rootVolumeType, encrypted, nonRootVolumes].forEach((field) => {
      expect(field.props('mode')).toBe(mode);
    });
  });
});
