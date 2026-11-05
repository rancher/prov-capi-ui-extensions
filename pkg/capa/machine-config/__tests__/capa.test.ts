import { reactive } from 'vue';
import { mount, shallowMount, flushPromises, VueWrapper } from '@vue/test-utils';
import { _CREATE, _EDIT } from '@shell/config/query-params';
import { Banner } from '@components/Banner';
import MachineConfigCapa from '../capa.vue';
import InstanceConfigSection from '../InstanceConfigSection.vue';
import StorageSection from '../StorageSection.vue';
import AdvancedSection from '../AdvancedSection.vue';
import { UBUNTU_LTS_AMI_NAME_PATTERNS } from '../constants';
import {
  createAwsStore, depaginateCalls, INSTANCE_TYPES, INSTANCE_PROFILES, KEY_PAIRS, KMS_KEYS, SECURITY_GROUPS, SUBNETS
} from '../../__tests__/fixtures/aws';

const CREDENTIAL_ID = 'cattle-global-data:cc-abc';

const infrastructureCluster = (region = 'us-west-2', network: Record<string, any> = {}) => ({ spec: { region, network } });

type WrapperOptions = {
  value?: Record<string, any>;
  infra?: Record<string, any>;
  credentialId?: string;
  mode?: string;
  overrides?: Record<string, (payload: any) => any>;
};

const createWrapper = ({
  value = {}, infra = infrastructureCluster(), credentialId = CREDENTIAL_ID, mode = _CREATE, overrides = {}
}: WrapperOptions = {}) => {
  const store = createAwsStore(overrides);
  const reactiveValue = reactive(value);
  const wrapper: VueWrapper<any> = shallowMount(MachineConfigCapa, {
    props: {
      value: reactiveValue, uuid: 'pool-1', infrastructureCluster: infra, credentialId, mode
    },
    global: { provide: { store }, mocks: { $store: store } },
  });

  return {
    wrapper, store, value: reactiveValue
  };
};

const templateSpec = (value: Record<string, any>) => value.spec.template.spec;

// The AWS lookups are debounced by 1ms
const waitForAwsCalls = async() => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await flushPromises();
};

const sections = (wrapper: any) => ({
  instance: wrapper.findComponent(InstanceConfigSection),
  storage:  wrapper.findComponent(StorageSection),
  advanced: wrapper.findComponent(AdvancedSection),
});

const existingPool = (spec: Record<string, any>) => ({ metadata: { name: 'cfg', creationTimestamp: '2025-01-01T00:00:00Z' }, spec: { template: { spec } } });

describe('component: MachineConfigCapa', () => {
  describe('defaults', () => {
    it('should fill in the AWSMachineTemplate defaults for a new pool', () => {
      const { value } = createWrapper({ credentialId: '' });

      expect(templateSpec(value)).toStrictEqual({
        ami:                     {},
        cloudInit:               { insecureSkipSecretsManager: true },
        iamInstanceProfile:      '',
        instanceMetadataOptions: { httpTokens: 'required' },
        instanceType:            't3.medium',
        marketType:              'OnDemand',
        publicIP:                false,
        rootVolume:              {
          encrypted: false, size: 32, type: 'gp3'
        },
        sshKeyName:               '',
        privateDnsName:           { hostnameType: 'resource-name' },
        nonRootVolumes:           [],
        additionalSecurityGroups: [],
      });
    });

    it('should keep the values of a new pool that were already set', () => {
      const { value } = createWrapper({
        credentialId: '',
        value:        {
          spec: {
            template: {
              spec: {
                instanceType: 'm5.large', publicIP: true, rootVolume: { size: 100 }, marketType: 'Spot', spotMarketOptions: { maxPrice: '0.1' }
              }
            }
          }
        }
      });
      const spec = templateSpec(value);

      expect(spec.instanceType).toBe('m5.large');
      expect(spec.publicIP).toBe(true);
      expect(spec.rootVolume).toStrictEqual({
        size: 100, encrypted: false, type: 'gp3'
      });
      expect(spec.spotMarketOptions).toStrictEqual({ maxPrice: '0.1' });
    });

    it('should add empty spot options to a new spot pool', () => {
      const { value } = createWrapper({ credentialId: '', value: { spec: { template: { spec: { marketType: 'Spot' } } } } });

      expect(templateSpec(value).spotMarketOptions).toStrictEqual({});
    });

    it('should not apply defaults to an existing pool', () => {
      const { value } = createWrapper({ credentialId: '', value: existingPool({ instanceType: 'm5.large', spotMarketOptions: { maxPrice: '1' } }) });

      expect(templateSpec(value)).toStrictEqual({
        instanceType:             'm5.large',
        rootVolume:               {},
        ami:                      {},
        cloudInit:                {},
        // the metadata token default is applied to every pool
        instanceMetadataOptions:  { httpTokens: 'required' },
        nonRootVolumes:           [],
        additionalSecurityGroups: [],
      });
    });

    it('should keep the spot options of an existing spot pool', () => {
      const { value } = createWrapper({ credentialId: '', value: existingPool({ marketType: 'Spot', spotMarketOptions: { maxPrice: '1' } }) });

      expect(templateSpec(value).spotMarketOptions).toStrictEqual({ maxPrice: '1' });
    });
  });

  describe('aws resources', () => {
    it('should not call aws without a region or credential', async() => {
      const { store, wrapper } = createWrapper({ infra: {} });

      await waitForAwsCalls();

      expect(store.dispatch).not.toHaveBeenCalled();

      const { instance, storage, advanced } = sections(wrapper);

      expect(instance.props('subnets')).toStrictEqual([]);
      expect(instance.props('keyPairs')).toStrictEqual([]);
      expect(instance.props('instanceProfiles')).toStrictEqual([]);
      expect(storage.props('kmsKeys')).toStrictEqual([]);
      expect(advanced.props('securityGroups')).toStrictEqual([]);
    });

    it('should create the aws clients for the cluster region and load the form options', async() => {
      const { store, wrapper } = createWrapper({ infra: infrastructureCluster('eu-west-1', { vpc: { id: 'vpc-user' }, subnets: [{ id: 'subnet-a' }, {}] }) });

      await waitForAwsCalls();

      ['aws/ec2', 'aws/iam', 'aws/kms'].forEach((action) => {
        expect(store.dispatch).toHaveBeenCalledWith(action, { region: 'eu-west-1', cloudCredentialId: CREDENTIAL_ID });
      });

      const clientFor = (cmd: string) => store.dispatch.mock.calls.find(([action, payload]) => action === 'aws/depaginateList' && payload.cmd === cmd)?.[1].client.client;

      expect(clientFor('describeKeyPairs')).toBe('ec2');
      expect(clientFor('describeSubnets')).toBe('ec2');
      expect(clientFor('describeSecurityGroups')).toBe('ec2');
      expect(clientFor('listInstanceProfiles')).toBe('iam');
      expect(clientFor('listKeys')).toBe('kms');
      expect(store.dispatch).toHaveBeenCalledWith('aws/describeInstanceTypes', { client: { client: 'ec2', region: 'eu-west-1' } });

      const { instance, storage, advanced } = sections(wrapper);

      expect(instance.props('instanceTypes')).toStrictEqual(INSTANCE_TYPES);
      expect(instance.props('subnets')).toStrictEqual(SUBNETS);
      expect(instance.props('keyPairs')).toStrictEqual(KEY_PAIRS);
      expect(instance.props('instanceProfiles')).toStrictEqual(INSTANCE_PROFILES);
      expect(instance.props('vpcId')).toBe('vpc-user');
      expect(instance.props('clusterSubnetIds')).toStrictEqual(['subnet-a']);
      expect(instance.props('loadingSubnets')).toBe(false);
      expect(storage.props('kmsKeys')).toStrictEqual(KMS_KEYS);
      expect(advanced.props('securityGroups')).toStrictEqual(SECURITY_GROUPS);
      expect(advanced.props('vpcId')).toBe('vpc-user');
      expect(wrapper.findAllComponents(Banner)).toHaveLength(0);
    });

    it.each([
      ['describeKeyPairs', 'capa.errors.fetchingSshKeys'],
      ['listInstanceProfiles', 'capa.errors.fetchingInstanceProfiles'],
      ['describeSubnets', 'capa.errors.fetchingSubnets'],
      ['describeSecurityGroups', 'capa.errors.fetchingSecurityGroups'],
      ['listKeys', 'capa.errors.fetchingKmsKeys'],
      ['describeImages', 'capa.errors.fetchingAmi'],
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

      const banners = wrapper.findAllComponents(Banner);

      expect(banners).toHaveLength(1);
      expect(banners[0].props('color')).toBe('error');
      expect(banners[0].props('label')).toContain(errorKey);
    });

    it('should show an error when the instance types cannot be loaded', async() => {
      const { wrapper } = createWrapper({
        overrides: {
          'aws/describeInstanceTypes': () => {
            throw new Error('denied');
          }
        }
      });

      await waitForAwsCalls();

      expect(wrapper.findAllComponents(Banner).map((b) => b.props('label'))).toStrictEqual([expect.stringContaining('capa.errors.fetchingInstanceTypes')]);
    });

    it.each([
      ['aws/ec2', 'capa.errors.fetchingEc2Client', ['listInstanceProfiles', 'listKeys']],
      ['aws/iam', 'capa.errors.fetchingIamClient', ['describeKeyPairs', 'describeSubnets', 'describeSecurityGroups', 'listKeys']],
      ['aws/kms', 'capa.errors.fetchingKmsClient', ['describeKeyPairs', 'listInstanceProfiles', 'describeSubnets', 'describeSecurityGroups']],
    ])('should show an error and skip the dependent lookups when %s fails', async(action, errorKey, expectedCalls) => {
      const { wrapper, store } = createWrapper({
        overrides: {
          [action]: () => {
            throw new Error('bad credential');
          }
        }
      });

      await waitForAwsCalls();

      expect(wrapper.findAllComponents(Banner).map((b) => b.props('label'))).toStrictEqual([expect.stringContaining(errorKey)]);
      expect(depaginateCalls(store.dispatch).filter((cmd) => cmd !== 'describeImages')).toStrictEqual(expectedCalls);
    });
  });

  describe('machine image', () => {
    it('should default to the newest Canonical Ubuntu LTS image', async() => {
      const { wrapper, value, store } = createWrapper();

      await waitForAwsCalls();

      const [describeImages] = store.dispatch.mock.calls.filter(([action, payload]) => action === 'aws/depaginateList' && payload.cmd === 'describeImages');

      expect(describeImages[1].opt.Owners).toStrictEqual(['099720109477']);
      expect(describeImages[1].opt.Filters).toContainEqual({ Name: 'name', Values: [UBUNTU_LTS_AMI_NAME_PATTERNS[0]] });
      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-new' });

      const { instance } = sections(wrapper);

      expect(instance.props('amiId')).toBe('ami-new');
      expect(instance.props('autoPopulatedAmiId')).toBe('ami-new');
      expect(instance.props('isAmiAutoPopulated')).toBe(true);
    });

    it('should try the older ubuntu releases when the newest has no image', async() => {
      const images = jest.fn((payload: any) => (payload.opt.Filters[0].Values[0] === UBUNTU_LTS_AMI_NAME_PATTERNS[2] ? [{ ImageId: 'ami-jammy', CreationDate: '2024-01-01' }] : []));
      const { value } = createWrapper({ overrides: { 'aws/depaginateList': (payload) => (payload.cmd === 'describeImages' ? images(payload) : []) } });

      await waitForAwsCalls();

      expect(images).toHaveBeenCalledTimes(3);
      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-jammy' });
    });

    it('should leave the image empty when no ubuntu image is found', async() => {
      const { value } = createWrapper({ overrides: { 'aws/depaginateList': () => [] } });

      await waitForAwsCalls();

      expect(templateSpec(value).ami).toStrictEqual({});
    });

    it('should not replace an image chosen by the user', async() => {
      const { wrapper, value } = createWrapper({ value: { spec: { template: { spec: { ami: { id: 'ami-custom' } } } } } });

      await waitForAwsCalls();

      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-custom' });
      expect(sections(wrapper).instance.props('isAmiAutoPopulated')).toBe(false);
    });

    it('should write the image typed by the user', () => {
      const { wrapper, value } = createWrapper({ credentialId: '' });

      sections(wrapper).instance.vm.$emit('update:amiId', 'ami-mine');

      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-mine' });
    });
  });

  describe('region or credential changes', () => {
    it('should reset the region-specific choices of a new pool', async() => {
      const { wrapper, value } = createWrapper({
        value: {
          spec: {
            template: {
              spec: {
                subnet: { id: 'subnet-a' }, sshKeyName: 'alice', additionalSecurityGroups: [{ id: 'sg-1' }], rootVolume: { encryptionKey: 'key-1' }
              }
            }
          }
        }
      });

      await waitForAwsCalls();
      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-new' });

      await wrapper.setProps({ infrastructureCluster: infrastructureCluster('eu-west-1') });
      await waitForAwsCalls();

      const spec = templateSpec(value);

      expect(spec.subnet).toStrictEqual({ id: null });
      expect(spec.sshKeyName).toBe('');
      expect(spec.additionalSecurityGroups).toStrictEqual([]);
      expect(spec.rootVolume.encryptionKey).toBe('');
      // the auto-populated image is replaced with the newest one for the new region
      expect(spec.ami).toStrictEqual({ id: 'ami-new' });
    });

    it('should reset the choices of a new pool when the credential changes', async() => {
      const { wrapper, value } = createWrapper({ value: { spec: { template: { spec: { sshKeyName: 'alice' } } } } });

      await waitForAwsCalls();
      await wrapper.setProps({ credentialId: 'cattle-global-data:cc-other' });
      await waitForAwsCalls();

      expect(templateSpec(value).sshKeyName).toBe('');
    });

    it('should keep the choices of an existing pool', async() => {
      const { wrapper, value } = createWrapper({
        value: existingPool({
          sshKeyName: 'alice', subnet: { id: 'subnet-a' }, ami: { id: 'ami-custom' }
        })
      });

      await waitForAwsCalls();
      await wrapper.setProps({ infrastructureCluster: infrastructureCluster('eu-west-1') });
      await waitForAwsCalls();

      expect(templateSpec(value).sshKeyName).toBe('alice');
      expect(templateSpec(value).subnet).toStrictEqual({ id: 'subnet-a' });
      expect(templateSpec(value).ami).toStrictEqual({ id: 'ami-custom' });
    });

    it('should drop the subnet when the cluster vpc changes', async() => {
      const { wrapper, value } = createWrapper({
        credentialId: '', value: existingPool({ subnet: { id: 'subnet-a' } }), infra: infrastructureCluster('us-west-2', { vpc: { id: 'vpc-user' } })
      });

      await wrapper.setProps({ infrastructureCluster: infrastructureCluster('us-west-2', { vpc: { id: 'vpc-capa' } }) });

      expect(templateSpec(value).subnet).toBeUndefined();
    });
  });

  describe('form updates', () => {
    it.each([
      ['instance', 'update:instanceType', 'm5.large', (s: any) => s.instanceType],
      ['instance', 'update:sshKeyName', 'bob', (s: any) => s.sshKeyName],
      ['instance', 'update:subnetId', 'subnet-b', (s: any) => s.subnet],
      ['instance', 'update:publicIP', true, (s: any) => s.publicIP],
      ['instance', 'update:iamInstanceProfile', 'nodes', (s: any) => s.iamInstanceProfile],
      ['instance', 'update:instanceMetadataHttpTokens', 'optional', (s: any) => s.instanceMetadataOptions],
      ['storage', 'update:rootVolumeSize', 64, (s: any) => s.rootVolume.size],
      ['storage', 'update:rootVolumeType', 'io2', (s: any) => s.rootVolume.type],
      ['storage', 'update:rootVolumeEncrypted', true, (s: any) => s.rootVolume.encrypted],
      ['storage', 'update:rootVolumeEncryptionKey', 'key-1', (s: any) => s.rootVolume.encryptionKey],
      ['storage', 'update:nonRootVolumes', [{ deviceName: '/dev/sdb' }], (s: any) => s.nonRootVolumes],
      ['advanced', 'update:cloudInitInsecureSkipSecretsManager', false, (s: any) => s.cloudInit],
      ['advanced', 'update:additionalSecurityGroups', [{ id: 'sg-1' }], (s: any) => s.additionalSecurityGroups],
      ['advanced', 'update:additionalTags', { team: 'capi' }, (s: any) => s.additionalTags],
    ])('should write %p %p to the template spec', async(section, event, input, read) => {
      const expected: Record<string, unknown> = {
        'update:subnetId':                            { id: 'subnet-b' },
        'update:instanceMetadataHttpTokens':          { httpTokens: 'optional' },
        'update:cloudInitInsecureSkipSecretsManager': { insecureSkipSecretsManager: false },
      };
      const { wrapper, value } = createWrapper({ credentialId: '' });

      (sections(wrapper) as Record<string, any>)[section].vm.$emit(event, input);
      await flushPromises();

      expect(read(templateSpec(value))).toStrictEqual(event in expected ? expected[event] : input);
      expect(wrapper.emitted('update:value')?.pop()).toStrictEqual([value]);
    });

    it('should remove the subnet when "none" is selected', () => {
      const { wrapper, value } = createWrapper({ credentialId: '', value: { spec: { template: { spec: { subnet: { id: 'subnet-a' } } } } } });

      sections(wrapper).instance.vm.$emit('update:subnetId', null);

      expect(templateSpec(value).subnet).toBeUndefined();
    });

    it('should manage the spot options with the market type', () => {
      const { wrapper, value } = createWrapper({ credentialId: '' });
      const { advanced } = sections(wrapper);

      advanced.vm.$emit('update:marketType', 'Spot');
      expect(templateSpec(value).spotMarketOptions).toStrictEqual({});

      advanced.vm.$emit('update:spotMarketMaxPrice', '0.25');
      expect(templateSpec(value).spotMarketOptions).toStrictEqual({ maxPrice: '0.25' });

      advanced.vm.$emit('update:spotMarketMaxPrice', undefined);
      expect(templateSpec(value).spotMarketOptions).toStrictEqual({});

      advanced.vm.$emit('update:marketType', 'CapacityBlock');
      expect(templateSpec(value).marketType).toBe('CapacityBlock');
      expect(templateSpec(value).spotMarketOptions).toBeUndefined();
    });

    it('should ignore a spot price when the pool is not a spot pool', () => {
      const { wrapper, value } = createWrapper({ credentialId: '' });

      sections(wrapper).advanced.vm.$emit('update:spotMarketMaxPrice', '0.25');

      expect(templateSpec(value).spotMarketOptions).toBeUndefined();
    });

    it('should pass the current values down to the sections', () => {
      const { wrapper } = createWrapper({
        credentialId: '',
        mode:         _EDIT,
        value:        existingPool({
          instanceType:      'c5.large',
          marketType:        'Spot',
          spotMarketOptions: { maxPrice: '0.5' },
          rootVolume:        {
            size: 40, type: 'io1', encrypted: true, encryptionKey: 'key-2'
          }
        })
      });
      const { instance, storage, advanced } = sections(wrapper);

      expect(instance.props('instanceType')).toBe('c5.large');
      expect(instance.props('mode')).toBe(_EDIT);
      expect(storage.props('rootVolumeSize')).toBe(40);
      expect(storage.props('rootVolumeType')).toBe('io1');
      expect(storage.props('rootVolumeEncrypted')).toBe(true);
      expect(storage.props('rootVolumeEncryptionKey')).toBe('key-2');
      expect(storage.props('mode')).toBe(_EDIT);
      expect(advanced.props('marketType')).toBe('Spot');
      expect(advanced.props('spotMarketMaxPrice')).toBe('0.5');
      expect(advanced.props('mode')).toBe(_EDIT);
    });
  });

  describe('validation', () => {
    // validationChanged mirrors vee-validate's form state, which only knows about fields that are mounted, so
    // these tests render the real sections instead of the shallow stubs used above.
    const mountFull = (value: Record<string, any>) => {
      const store = createAwsStore();
      const reactiveValue = reactive(value);
      const wrapper: VueWrapper<any> = mount(MachineConfigCapa, {
        props: {
          value: reactiveValue, uuid: 'pool-1', infrastructureCluster: {}, credentialId: ''
        },
        global: { provide: { store }, mocks: { $store: store } },
      });

      return { wrapper, value: reactiveValue };
    };

    const validPool = (spec: Record<string, any> = {}) => ({
      spec: {
        template: {
          spec: {
            ami: { id: 'ami-1' }, iamInstanceProfile: 'nodes', ...spec
          }
        }
      }
    });

    beforeEach(() => {
      // RcSection looks for an optional form summary and vue-select exposes `_options`; both only warn when
      // the real sections are rendered outside the dashboard
      // eslint-disable-next-line no-console
      const warn = console.warn;

      jest.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
        if (!/Symbol\(formSummary\)|"_options"/.test(String(args[0]))) {
          warn(...args);
        }
      });
    });

    it('should be valid once every required field is set', async() => {
      const { wrapper } = mountFull(validPool());

      await flushPromises();

      expect(wrapper.emitted('validationChanged')).toStrictEqual([[true]]);
    });

    it('should be invalid while the image and instance profile are missing', async() => {
      const { wrapper } = mountFull({});

      await flushPromises();

      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([false]);
    });

    it('should become invalid when the user clears the machine image, and valid again when it is set', async() => {
      const { wrapper, value } = mountFull(validPool());

      await flushPromises();

      const ami = wrapper.find('input[name="amiId"]');

      await ami.setValue('');
      await flushPromises();

      expect(templateSpec(value).ami.id).toBe('');
      expect(wrapper.emitted('validationChanged')).toStrictEqual([[true], [false]]);

      await ami.setValue('ami-2');
      await flushPromises();

      expect(templateSpec(value).ami.id).toBe('ami-2');
      expect(wrapper.emitted('validationChanged')).toStrictEqual([[true], [false], [true]]);
    });

    it('should become invalid when the instance profile is cleared', async() => {
      const { wrapper, value } = mountFull(validPool());

      await flushPromises();
      templateSpec(value).iamInstanceProfile = '';
      await flushPromises();

      expect(wrapper.emitted('validationChanged')).toStrictEqual([[true], [false]]);
    });

    it('should require a root volume size', async() => {
      const { wrapper } = mountFull(validPool({ rootVolume: { size: null, type: 'gp3' } }));

      await flushPromises();

      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([false]);
    });

    it('should require a KMS key only while the root volume is encrypted', async() => {
      const { wrapper, value } = mountFull(validPool({
        rootVolume: {
          size: 32, type: 'gp3', encrypted: true
        }
      }));

      await flushPromises();
      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([false]);

      templateSpec(value).rootVolume.encryptionKey = 'key-1';
      await flushPromises();
      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([true]);

      templateSpec(value).rootVolume.encryptionKey = '';
      await flushPromises();
      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([false]);

      // turning encryption off removes the key select, and with it the requirement
      templateSpec(value).rootVolume.encrypted = false;
      await flushPromises();
      expect(wrapper.emitted('validationChanged')?.pop()).toStrictEqual([true]);
    });

    it('should pass the field rules to the sections', () => {
      const { wrapper } = createWrapper({ credentialId: '' });
      const { instance, storage } = sections(wrapper);
      const instanceRules = instance.props('rules') as Record<string, any[]>;
      const storageRules = storage.props('rules') as Record<string, any[]>;

      expect(Object.keys(instanceRules)).toStrictEqual(['amiId', 'iamInstanceProfile']);
      expect(Object.keys(storageRules)).toStrictEqual(['rootVolumeSize', 'rootVolumeType', 'rootVolumeEncryptionKey']);
      expect(instanceRules.amiId[0]('')).toBeTruthy();
      expect(instanceRules.amiId[0]('ami-1')).toBeUndefined();
      // the encryption key is only required while encryption is enabled
      expect(storageRules.rootVolumeEncryptionKey[0]('')).toBeUndefined();
    });
  });
});
