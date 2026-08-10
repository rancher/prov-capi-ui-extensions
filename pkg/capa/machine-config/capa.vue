<script setup lang="ts">
import {
  computed, ref, toRefs, watch, WritableComputedRef
} from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { useFormValidation } from '@shell/composables/useFormValidation';
import { Banner } from '@components/Banner';
import {
  MACHINE_CONFIG_DEFAULTS,
  MARKET_TYPES,
  UBUNTU_LTS_AMI_NAME_PATTERNS
} from './constants';
import { stringify } from '@shell/utils/error';
import { _CREATE } from '@shell/config/query-params';
import InstanceConfigSection from './InstanceConfigSection.vue';
import StorageSection from './StorageSection.vue';
import AdvancedSection from './AdvancedSection.vue';
import debounce from 'lodash/debounce';
defineOptions({ name: 'MachineConfigCapa' });

const emit = defineEmits(['validationChanged', 'update:value']);

interface Props {
  value: Record<string, any>;
  uuid: string;
  infrastructureCluster?: Record<string, any>;
  cluster?: Record<string, any>;
  credentialId: string;
  mode?: string;
}

const props = withDefaults(defineProps<Props>(), {
  infrastructureCluster: () => ({}),
  cluster:               () => ({}),
  mode:                  _CREATE,
});

const {
  value,
  credentialId,
  infrastructureCluster,
  mode,
} = toRefs(props);

const store = useStore();
const { t } = useI18n(store);

const errors = ref<any[]>([]);
const ec2Client = ref<any>(null);
const iamClient = ref<any>(null);
const kmsClient = ref<any>(null);
const instanceTypes = ref<any>(null);
const instanceProfiles = ref<any>(null);
const subnets = ref<any>(null);
const securityGroups = ref<any>(null);
const sshKeys = ref<any>(null);
const kmsKeys = ref<any>(null);
const loadingInstanceTypes = ref(false);
const loadingSshKeys = ref(false);
const loadingInstanceProfiles = ref(false);
const loadingSubnets = ref(false);
const loadingSecurityGroups = ref(false);
const loadingKmsKeys = ref(false);
const autoPopulatedAmiId = ref<string | null>(null);

function ensureTemplateSpec(): Record<string, any> {
  const model = (value.value && typeof value.value === 'object') ? value.value : {};

  if (model !== value.value) {
    emit('update:value', model);
  }

  model.spec = model.spec || {};
  model.spec.template = model.spec.template || {};
  model.spec.template.spec = model.spec.template.spec || {};

  return model.spec.template.spec;
}

const isNew = computed(() => {
  // Pool is new if it has no creation timestamp (not yet created in Kubernetes)
  return !value.value?.metadata?.creationTimestamp;
});

function setSpecAmiId(amiId: string | null) {
  const templateSpec = ensureTemplateSpec();

  templateSpec.ami = { ...(templateSpec.ami || {}), id: amiId };
}

const spec: WritableComputedRef<Record<string, any>> = computed({
  get() {
    const model = (value.value && typeof value.value === 'object') ? value.value : {};

    if (model !== value.value) {
      emit('update:value', model);
    }
    model.spec = model.spec || {};
    model.spec.template = model.spec.template || {};
    model.spec.template.spec = model.spec.template.spec || {};
    const s = model.spec.template.spec;

    // Important: never replace the whole model in the getter. Replacing it
    // causes v-model controls (e.g. publicIP checkbox) to snap back on render.
    if (isNew.value) {
      s.ami = s.ami || { ...MACHINE_CONFIG_DEFAULTS.ami };
      s.cloudInit = s.cloudInit || { ...MACHINE_CONFIG_DEFAULTS.cloudInit };
      s.iamInstanceProfile = s.iamInstanceProfile || MACHINE_CONFIG_DEFAULTS.iamInstanceProfile;

      s.instanceMetadataOptions = s.instanceMetadataOptions || {};
      if (!s.instanceMetadataOptions.httpTokens) {
        s.instanceMetadataOptions.httpTokens = MACHINE_CONFIG_DEFAULTS.instanceMetadataOptions.httpTokens;
      }

      if (!s.instanceType) {
        s.instanceType = MACHINE_CONFIG_DEFAULTS.instanceType;
      }
      if (!s.marketType) {
        s.marketType = MACHINE_CONFIG_DEFAULTS.marketType;
      }
      if (s.publicIP === undefined) {
        s.publicIP = MACHINE_CONFIG_DEFAULTS.publicIP;
      }

      s.rootVolume = s.rootVolume || {};
      if (s.rootVolume.encrypted === undefined) {
        s.rootVolume.encrypted = MACHINE_CONFIG_DEFAULTS.rootVolume.encrypted;
      }
      if (s.rootVolume.size === undefined) {
        s.rootVolume.size = MACHINE_CONFIG_DEFAULTS.rootVolume.size;
      }
      if (!s.rootVolume.type) {
        s.rootVolume.type = MACHINE_CONFIG_DEFAULTS.rootVolume.type;
      }

      s.sshKeyName = s.sshKeyName || MACHINE_CONFIG_DEFAULTS.sshKeyName;
      s.privateDnsName = s.privateDnsName || { ...MACHINE_CONFIG_DEFAULTS.privateDnsName };
      if (!Array.isArray(s.nonRootVolumes)) {
        s.nonRootVolumes = [];
      }
      if (!Array.isArray(s.additionalSecurityGroups)) {
        s.additionalSecurityGroups = [];
      }
      if (s.marketType === MARKET_TYPES.SPOT) {
        s.spotMarketOptions = s.spotMarketOptions || {};
      } else {
        delete s.spotMarketOptions;
      }
    } else {
      s.rootVolume = s.rootVolume || {};
      s.ami = s.ami || {};
      s.cloudInit = s.cloudInit || {};
      s.instanceMetadataOptions = s.instanceMetadataOptions || {};
      if (!Array.isArray(s.nonRootVolumes)) {
        s.nonRootVolumes = [];
      }
      if (!Array.isArray(s.additionalSecurityGroups)) {
        s.additionalSecurityGroups = [];
      }
      if (s.marketType === MARKET_TYPES.SPOT) {
        s.spotMarketOptions = s.spotMarketOptions || {};
      } else {
        delete s.spotMarketOptions;
      }
    }

    return model.spec.template.spec;
  },
  set(neu: Record<string, any>) {
    value.value.spec = value.value.spec || {};
    value.value.spec.template = value.value.spec.template || {};
    value.value.spec.template.spec = neu;
  },
});

// Emit update:value whenever spec changes (via mutations or replacement)
watch(() => spec.value, () => {
  emit('update:value', value.value);
}, { deep: true });

const instanceType = computed({
  get: () => spec.value.instanceType,
  set: (val: string) => {
    spec.value.instanceType = val;
  }
});

const sshKeyName = computed({
  get: () => spec.value.sshKeyName,
  set: (val: string) => {
    spec.value.sshKeyName = val;
  }
});

const subnetId = computed({
  get: () => spec.value.subnet?.id || null,
  set: (val: string | null) => {
    if (!val) {
      delete spec.value.subnet;

      return;
    }
    spec.value.subnet = { ...(spec.value.subnet || {}), id: val };
  }
});

const publicIP = computed({
  get: () => !!spec.value.publicIP,
  set: (val: boolean) => {
    spec.value.publicIP = val;
  }
});

const amiId = computed({
  get: () => spec.value.ami?.id || '',
  set: (val: string) => {
    setSpecAmiId(val);
  }
});

const iamInstanceProfile = computed({
  get: () => spec.value.iamInstanceProfile || '',
  set: (val: string) => {
    spec.value.iamInstanceProfile = val;
  }
});

const instanceMetadataHttpTokens = computed({
  get: () => spec.value.instanceMetadataOptions?.httpTokens || MACHINE_CONFIG_DEFAULTS.instanceMetadataOptions.httpTokens,
  set: (val: string) => {
    spec.value.instanceMetadataOptions = {
      ...(spec.value.instanceMetadataOptions || {}),
      httpTokens: val,
    };
  }
});

const rootVolumeSize = computed({
  get: () => spec.value.rootVolume?.size,
  set: (val: number) => {
    spec.value.rootVolume = { ...(spec.value.rootVolume || {}), size: val };
  }
});

const rootVolumeType = computed({
  get: () => spec.value.rootVolume?.type,
  set: (val: string) => {
    spec.value.rootVolume = { ...(spec.value.rootVolume || {}), type: val };
  }
});

const rootVolumeEncrypted = computed({
  get: () => !!spec.value.rootVolume?.encrypted,
  set: (val: boolean) => {
    spec.value.rootVolume = { ...(spec.value.rootVolume || {}), encrypted: val };
  }
});

const rootVolumeEncryptionKey = computed({
  get: () => spec.value.rootVolume?.encryptionKey || '',
  set: (val: string) => {
    spec.value.rootVolume = { ...(spec.value.rootVolume || {}), encryptionKey: val };
  }
});

const { getRules, isFormValid } = useFormValidation(
  t,
  [
    {
      path:           'amiId',
      rules:          ['required'],
      translationKey: 'capa.machineConfig.instanceConfiguration.advanced.machineImage.label',
    },
    {
      path:           'iamInstanceProfile',
      rules:          ['required'],
      translationKey: 'capa.machineConfig.instanceConfiguration.advanced.iamInstanceProfileName.label',
    },
    {
      path:           'rootVolumeSize',
      rules:          ['required'],
      translationKey: 'capa.machineConfig.storage.rootVolume.size.label',
    },
    {
      path:           'rootVolumeType',
      rules:          ['required'],
      translationKey: 'capa.machineConfig.storage.rootVolume.type.label',
    },
    { path: 'rootVolumeEncryptionKey', rules: ['rootVolumeEncryptionKey'] },
  ],
  { rootVolumeEncryptionKey: (val: unknown) => (rootVolumeEncrypted.value && !val) ? t('validation.required', { key: t('capa.machineConfig.storage.rootVolume.encryptionKey.label') }) : undefined }
);

watch(isFormValid, (valid) => {
  emit('validationChanged', valid);
}, { immediate: true });

const nonRootVolumes = computed({
  get: () => spec.value.nonRootVolumes || [],
  set: (val: Record<string, any>[]) => {
    spec.value.nonRootVolumes = val || [];
  }
});

const cloudInitInsecureSkipSecretsManager = computed({
  get: () => !!spec.value.cloudInit?.insecureSkipSecretsManager,
  set: (val: boolean) => {
    spec.value.cloudInit = {
      ...(spec.value.cloudInit || {}),
      insecureSkipSecretsManager: val,
    };
  }
});

const additionalSecurityGroups = computed({
  get: () => spec.value.additionalSecurityGroups || [],
  set: (val: Array<{ id: string }>) => {
    spec.value.additionalSecurityGroups = val || [];
  }
});

const marketType = computed({
  get: () => spec.value.marketType || MACHINE_CONFIG_DEFAULTS.marketType,
  set: (val: string) => {
    spec.value.marketType = val;

    if (val === MARKET_TYPES.SPOT) {
      spec.value.spotMarketOptions = spec.value.spotMarketOptions || {};
    } else {
      delete spec.value.spotMarketOptions;
    }
  }
});

const spotMarketMaxPrice = computed({
  get: () => spec.value.marketType === MARKET_TYPES.SPOT ? (spec.value.spotMarketOptions?.maxPrice || '') : '',
  set: (val: string | undefined) => {
    if (spec.value.marketType !== MARKET_TYPES.SPOT) {
      delete spec.value.spotMarketOptions;

      return;
    }

    const current = { ...(spec.value.spotMarketOptions || {}) };

    if (val === undefined || val === '') {
      delete current.maxPrice;
    } else {
      current.maxPrice = val;
    }

    spec.value.spotMarketOptions = current;
  }
});

const additionalTags = computed({
  get: () => spec.value.additionalTags || {},
  set: (val: Record<string, string>) => {
    spec.value.additionalTags = val || {};
  }
});

const region = computed(() => infrastructureCluster.value?.spec?.region || null);
const vpcId = computed(() => infrastructureCluster.value?.spec?.network?.vpc?.id || '');

// Subnet ids explicitly defined on the infrastructure cluster. Empty when the
// cluster relies on cluster-managed (auto-discovered) subnets.
const clusterSubnetIds = computed(() => {
  return (infrastructureCluster.value?.spec?.network?.subnets || [])
    .map((subnet: { id?: string }) => subnet.id)
    .filter((id: string | undefined): id is string => !!id);
});

watch(vpcId, (newVpcId, oldVpcId) => {
  if (newVpcId !== oldVpcId) {
    subnetId.value = null;
  }
});

// Look up the most recent Canonical Ubuntu LTS AMI available in the current region
async function fetchLatestUbuntuAmi(): Promise<string | null> {
  for ( const namePattern of UBUNTU_LTS_AMI_NAME_PATTERNS ) {
    const images: Array<{ ImageId?: string; CreationDate?: string }> = await store.dispatch('aws/depaginateList', {
      client: ec2Client.value,
      cmd:    'describeImages',
      key:    'Images',
      opt:    {
        Owners:  ['099720109477'], // Canonical
        Filters: [
          { Name: 'name', Values: [namePattern] },
          { Name: 'architecture', Values: ['x86_64'] },
          { Name: 'root-device-type', Values: ['ebs'] },
          { Name: 'virtualization-type', Values: ['hvm'] },
          { Name: 'state', Values: ['available'] },
        ],
      },
    });

    const latest = (images || [])
      .filter((image) => !!image.ImageId && !!image.CreationDate)
      .sort((a, b) => (b.CreationDate as string).localeCompare(a.CreationDate as string))[0];

    if ( latest?.ImageId ) {
      return latest.ImageId;
    }
  }

  return null;
}

async function getSshKeys() {
  loadingSshKeys.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    sshKeys.value = [];
    loadingSshKeys.value = false;

    return;
  }

  try {
    const keys = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeKeyPairs' });

    sshKeys.value = keys || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingSshKeys', { error: e }));
  } finally {
    loadingSshKeys.value = false;
  }
}

async function getInstanceProfiles() {
  loadingInstanceProfiles.value = true;
  if (!iamClient.value || !region.value || !credentialId.value) {
    instanceProfiles.value = [];
    loadingInstanceProfiles.value = false;

    return;
  }

  try {
    const profiles = await store.dispatch('aws/depaginateList', { client: iamClient.value, cmd: 'listInstanceProfiles' });

    instanceProfiles.value = profiles || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingInstanceProfiles', { error: e }));
  } finally {
    loadingInstanceProfiles.value = false;
  }
}

async function getSubnets() {
  loadingSubnets.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    subnets.value = [];
    loadingSubnets.value = false;

    return;
  }

  try {
    const subnetsList = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeSubnets' });

    subnets.value = subnetsList || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingSubnets', { error: e }));
  } finally {
    loadingSubnets.value = false;
  }
}

async function getSecurityGroups() {
  loadingSecurityGroups.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    securityGroups.value = [];
    loadingSecurityGroups.value = false;

    return;
  }

  try {
    const groups = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeSecurityGroups' });

    securityGroups.value = groups || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingSecurityGroups', { error: e }));
  } finally {
    loadingSecurityGroups.value = false;
  }
}

async function getKmsKeys() {
  loadingKmsKeys.value = true;
  if (!kmsClient.value || !region.value || !credentialId.value) {
    loadingKmsKeys.value = false;
    kmsKeys.value = [];

    return;
  }

  try {
    const keys = await store.dispatch('aws/depaginateList', { client: kmsClient.value, cmd: 'listKeys' });

    kmsKeys.value = keys || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingKmsKeys', { error: e }));
  } finally {
    loadingKmsKeys.value = false;
  }
}

async function getInstanceTypes() {
  loadingInstanceTypes.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    instanceTypes.value = [];
    loadingInstanceTypes.value = false;

    return;
  }

  try {
    const types = await store.dispatch('aws/describeInstanceTypes', { client: ec2Client.value });

    instanceTypes.value = types || [];
  } catch (e) {
    errors.value.push(t('capa.errors.fetchingInstanceTypes', { error: e }));
  } finally {
    loadingInstanceTypes.value = false;
  }
}

if (!spec.value.instanceMetadataOptions?.httpTokens) {
  spec.value.instanceMetadataOptions = {
    ...spec.value.instanceMetadataOptions,
    httpTokens: MACHINE_CONFIG_DEFAULTS.instanceMetadataOptions.httpTokens,
  };
}

if (!Array.isArray(spec.value.nonRootVolumes)) {
  spec.value.nonRootVolumes = [];
}

const debouncedFetchAll = debounce(() => {
  getSshKeys();
  getInstanceProfiles();
  getSubnets();
  getSecurityGroups();
  getKmsKeys();
  getInstanceTypes();
  fetchLatestUbuntuAmi().then((amiId) => {
    if (!amiId) {
      return;
    }

    const currentAmi = spec.value?.ami?.id;

    // Only auto-fill when the field is empty or still holds the previous
    // auto-populated value (i.e. the user hasn't typed in a custom AMI).
    if (!currentAmi || currentAmi === autoPopulatedAmiId.value) {
      setSpecAmiId(amiId);
      autoPopulatedAmiId.value = amiId;
    }
  }).catch((e) => {
    errors.value.push(t('capa.errors.fetchingAmi', { error: e }));
  });
}, 1);

watch([
  () => region.value,
  () => credentialId.value,
], async([newRegion, newCredentialId], [oldRegion, oldCredentialId]) => {
  errors.value = [];
  const credentialChanged = !!oldCredentialId && !!newCredentialId && newCredentialId !== oldCredentialId;

  if (region.value && credentialId.value) {
    try {
      ec2Client.value = await store.dispatch('aws/ec2', {
        region:            region.value,
        cloudCredentialId: credentialId.value
      });
    } catch (e) {
      ec2Client.value = null;
      errors.value.push(t('capa.errors.fetchingEc2Client', { error: e }));
    }

    try {
      iamClient.value = await store.dispatch('aws/iam', {
        region:            region.value,
        cloudCredentialId: credentialId.value
      });
    } catch (e) {
      iamClient.value = null;
      errors.value.push(t('capa.errors.fetchingIamClient', { error: e }));
    }

    try {
      kmsClient.value = await store.dispatch('aws/kms', {
        region:            region.value,
        cloudCredentialId: credentialId.value
      });
    } catch (e) {
      kmsClient.value = null;
      errors.value.push(t('capa.errors.fetchingKmsClient', { error: e }));
    }

    if (isNew.value && ((oldRegion && newRegion !== oldRegion) || credentialChanged)) {
      spec.value.subnet = { ...(spec.value.subnet || {}), id: null };
      spec.value.sshKeyName = '';
      spec.value.additionalSecurityGroups = [];
      spec.value.rootVolume = { ...(spec.value.rootVolume || {}), encryptionKey: '' };
      // Clear the AMI only when it hasn't been customized
      if (spec.value.ami?.id && spec.value.ami.id === autoPopulatedAmiId.value) {
        setSpecAmiId(null);
      }
    }

    debouncedFetchAll();
  } else {
    subnets.value = [];
    sshKeys.value = [];
    securityGroups.value = [];
    instanceProfiles.value = [];
    kmsKeys.value = [];
  }
}, { immediate: true });
</script>

<template>
  <div>
    <div v-if="errors?.length">
      <div
        v-for="(err, idx) in errors"
        :key="idx"
      >
        <Banner
          color="error"
          :label="stringify(err)"
        />
      </div>
    </div>
    <InstanceConfigSection
      v-model:instance-type="instanceType"
      v-model:ssh-key-name="sshKeyName"
      v-model:subnet-id="subnetId"
      v-model:public-i-p="publicIP"
      v-model:ami-id="amiId"
      v-model:iam-instance-profile="iamInstanceProfile"
      v-model:instance-metadata-http-tokens="instanceMetadataHttpTokens"
      :rules="{ amiId: getRules('amiId'), iamInstanceProfile: getRules('iamInstanceProfile') }"
      :instance-types="instanceTypes"
      :subnets="subnets"
      :instance-profiles="instanceProfiles"
      :key-pairs="sshKeys"
      :vpc-id="vpcId"
      :cluster-subnet-ids="clusterSubnetIds"
      :mode="mode"
      :is-ami-auto-populated="!!autoPopulatedAmiId && spec.ami?.id === autoPopulatedAmiId"
      :loading-ssh-keys="loadingSshKeys"
      :loading-instance-profiles="loadingInstanceProfiles"
      :loading-subnets="loadingSubnets"
      :loading-instance-types="loadingInstanceTypes"
      :auto-populated-ami-id="autoPopulatedAmiId"
    />
    <StorageSection
      v-model:root-volume-size="rootVolumeSize"
      v-model:root-volume-type="rootVolumeType"
      v-model:root-volume-encrypted="rootVolumeEncrypted"
      v-model:root-volume-encryption-key="rootVolumeEncryptionKey"
      v-model:non-root-volumes="nonRootVolumes"
      :rules="{ rootVolumeSize: getRules('rootVolumeSize'), rootVolumeType: getRules('rootVolumeType'), rootVolumeEncryptionKey: getRules('rootVolumeEncryptionKey') }"
      :mode="mode"
      :kms-keys="kmsKeys"
      :loading-kms-keys="loadingKmsKeys"
    />
    <AdvancedSection
      v-model:cloud-init-insecure-skip-secrets-manager="cloudInitInsecureSkipSecretsManager"
      v-model:additional-security-groups="additionalSecurityGroups"
      v-model:market-type="marketType"
      v-model:spot-market-max-price="spotMarketMaxPrice"
      v-model:additional-tags="additionalTags"
      :security-groups="securityGroups"
      :loading-security-groups="loadingSecurityGroups"
      :vpc-id="vpcId"
      :mode="mode"
    />
  </div>
</template>

