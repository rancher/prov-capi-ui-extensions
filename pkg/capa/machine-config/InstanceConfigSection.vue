<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { RcSection } from '@components/RcSection';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Checkbox } from '@components/Form/Checkbox';
import { getSubnetDisplayName } from '@shell/utils/aws';
import { HTTP_TOKENS_VALUES, MACHINE_CONFIG_DEFAULTS } from './constants';
import { _CREATE } from '@shell/config/query-params';

const SUBNET_NONE = '__none__';

type Validator = (val: unknown) => string | undefined;

defineOptions({ name: 'InstanceConfigSection' });

const emit = defineEmits([
  'update:instanceType',
  'update:sshKeyName',
  'update:subnetId',
  'update:publicIP',
  'update:amiId',
  'update:iamInstanceProfile',
  'update:instanceMetadataHttpTokens',
]);

interface Props {
  instanceType?: string;
  sshKeyName?: string;
  subnetId?: string | null;
  publicIP?: boolean;
  amiId?: string | null;
  iamInstanceProfile?: string;
  instanceMetadataHttpTokens?: string;
  instanceTypes?: Record<string, any>[];
  subnets?: Record<string, any>[];
  instanceProfiles?: Record<string, any>[];
  keyPairs?: Record<string, any>[];
  autoPopulatedAmiId?: string | null;
  vpcId?: string;
  // Subnet ids explicitly defined on the infrastructure cluster. Empty when the
  // cluster relies on cluster-managed (auto-discovered) subnets.
  clusterSubnetIds?: string[];
  mode?: string;
  loadingSshKeys?: boolean;
  loadingInstanceProfiles?: boolean;
  loadingSubnets?: boolean;
  loadingSecurityGroups?: boolean;
  loadingInstanceTypes?: boolean;
  isAmiAutoPopulated?: boolean;
  rules?: Record<string, Validator[]>;
}

const props = withDefaults(defineProps<Props>(), {
  instanceType:               MACHINE_CONFIG_DEFAULTS.instanceType,
  sshKeyName:                 MACHINE_CONFIG_DEFAULTS.sshKeyName,
  subnetId:                   null,
  publicIP:                   MACHINE_CONFIG_DEFAULTS.publicIP,
  amiId:                      '',
  iamInstanceProfile:         MACHINE_CONFIG_DEFAULTS.iamInstanceProfile,
  instanceMetadataHttpTokens: MACHINE_CONFIG_DEFAULTS.instanceMetadataOptions.httpTokens,
  instanceTypes:              () => [],
  subnets:                    () => [],
  instanceProfiles:           () => [],
  keyPairs:                   () => [],
  autoPopulatedAmiId:         null,
  vpcId:                      '',
  clusterSubnetIds:           () => [],
  mode:                       _CREATE,
  loadingSshKeys:             false,
  loadingInstanceProfiles:    false,
  loadingSubnets:             false,
  loadingSecurityGroups:      false,
  loadingInstanceTypes:       false,
  isAmiAutoPopulated:         false,
  rules:                      () => ({}),
});

const store = useStore();
const { t } = useI18n(store);

const modelInstanceType = computed({
  get: () => props.instanceType || MACHINE_CONFIG_DEFAULTS.instanceType,
  set: (val: string) => emit('update:instanceType', val),
});

const modelSshKeyName = computed({
  get: () => props.sshKeyName || MACHINE_CONFIG_DEFAULTS.sshKeyName,
  set: (val: string) => emit('update:sshKeyName', val),
});

const modelPublicIP = computed({
  get: () => props.publicIP ?? MACHINE_CONFIG_DEFAULTS.publicIP,
  set: (val: boolean) => emit('update:publicIP', val),
});

const modelIamInstanceProfile = computed({
  get: () => props.iamInstanceProfile || MACHINE_CONFIG_DEFAULTS.iamInstanceProfile,
  set: (val: string) => emit('update:iamInstanceProfile', val),
});

const modelInstanceMetadataHttpTokens = computed({
  get: () => props.instanceMetadataHttpTokens || MACHINE_CONFIG_DEFAULTS.instanceMetadataOptions.httpTokens,
  set: (val: string) => emit('update:instanceMetadataHttpTokens', val),
});
const httpTokensOptions = computed(() => [
  { label: t('capa.machineConfig.instanceConfiguration.advanced.instanceMetadataOptions.httpTokens.options.required'), value: HTTP_TOKENS_VALUES.REQUIRED },
  { label: t('capa.machineConfig.instanceConfiguration.advanced.instanceMetadataOptions.httpTokens.options.optional'), value: HTTP_TOKENS_VALUES.OPTIONAL },
]);

const instanceTypeOptions = computed(() => {
  let lastGroup;
  const out = [];

  for ( const row of (props.instanceTypes || []) ) {
    if ( row.groupLabel !== lastGroup ) {
      out.push({
        kind:     'group',
        disabled: false,
        label:    row.groupLabel
      });

      lastGroup = row.groupLabel;
    }

    out.push({
      label: row['label'],
      value: row['apiName'],
    });
  }

  return out;
});

function getSubnetOption(subnet: Record<string, any>) {
  const subnetId = subnet.SubnetId || subnet.id;

  if (!subnetId) {
    return null;
  }

  return {
    label: subnet.SubnetId ? getSubnetDisplayName(subnet as any) : subnetId,
    value: subnetId,
  };
}

const subnetOptions = computed(() => {
  const options = (props.subnets || [])
    .filter((subnet: Record<string, any>) => !subnet.VpcId || (!!props.vpcId && subnet.VpcId === props.vpcId))
    .map((subnet: Record<string, any>) => getSubnetOption(subnet))
    .filter((option): option is { label: string; value: string } => !!option)
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));

  return [
    { label: t('capa.machineConfig.instanceConfiguration.subnet.none'), value: SUBNET_NONE },
    ...options
  ];
});

const selectedSubnetId = computed({
  get() {
    if (!props.vpcId) {
      return SUBNET_NONE;
    }

    return props.subnetId || SUBNET_NONE;
  },
  set(val: string) {
    emit('update:subnetId', (!props.vpcId || val === SUBNET_NONE) ? null : val);
  }
});

const instanceProfileOptions = computed(() => {
  return (props.instanceProfiles || [])
    .map((profile: Record<string, any>) => profile.InstanceProfileName)
    .filter((name: string | undefined) => !!name);
});

const sshKeyOptions = computed(() => {
  const noneOption = { label: t('capa.machineConfig.instanceConfiguration.sshKeyName.noneLabel'), value: '' };

  const keys = (props.keyPairs || [])
    .map((keyPair: Record<string, any>) => keyPair.KeyName)
    .filter((name: string | undefined): name is string => !!name)
    .map((name: string) => ({ label: name, value: name }));

  return [noneOption, ...keys];
});

const amiDisplayId = computed({
  get() {
    const amiId = props.amiId || '';

    if (props.isAmiAutoPopulated && amiId) {
      return `${ amiId } (${ t('capa.machineConfig.instanceConfiguration.advanced.machineImage.latestUbuntu') })`;
    }

    return amiId;
  },
  set(val: string) {
    emit('update:amiId', val);
  },
});

const amiPlaceholder = computed(() => {
  return props.autoPopulatedAmiId || '';
});

</script>

<template>
  <RcSection
    :title="t('capa.machineConfig.instanceConfiguration.title')"
    :expandable="true"
    mode="with-header"
    type="primary"
  >
    <p>{{ t('capa.machineConfig.instanceConfiguration.description') }}</p>
    <div class="span-8">
      <LabeledSelect
        v-model:value="modelInstanceType"
        :options="instanceTypeOptions"
        label-key="capa.machineConfig.instanceConfiguration.instanceType.label"
        option-key="value"
        option-label="label"
        :mode="mode"
        :loading="loadingInstanceTypes"
      />
    </div>
    <div class="span-8">
      <LabeledSelect
        v-model:value="modelSshKeyName"
        :options="sshKeyOptions"
        :mode="mode"
        label-key="capa.machineConfig.instanceConfiguration.sshKeyName.label"
        :sub-label="t('capa.machineConfig.instanceConfiguration.sshKeyName.description')"
        :loading="loadingSshKeys"
      />
    </div>
    <div class="span-8">
      <LabeledInput
        v-model:value="amiDisplayId"
        name="amiId"
        :rules="rules.amiId"
        label-key="capa.machineConfig.instanceConfiguration.advanced.machineImage.label"
        :placeholder="amiPlaceholder"
        :mode="mode"
        required
      />
    </div>
    <div class="span-8">
      <LabeledSelect
        v-model:value="modelIamInstanceProfile"
        name="iamInstanceProfile"
        :rules="rules.iamInstanceProfile"
        :options="instanceProfileOptions"
        :taggable="true"
        :mode="mode"
        :loading="loadingInstanceProfiles"
        label-key="capa.machineConfig.instanceConfiguration.advanced.iamInstanceProfileName.label"
        required
      />
    </div>
    <Checkbox
      v-model:value="modelPublicIP"
      :mode="mode"
      label-key="capa.machineConfig.instanceConfiguration.publicIP.label"
      :tooltip="t('capa.machineConfig.instanceConfiguration.publicIP.tooltip')"
    />

    <RcSection
      :title="t('capa.machineConfig.instanceConfiguration.advanced.title')"
      :expandable="true"
      mode="with-header"
      type="secondary"
      :expanded="false"
      class="mmt-2"
    >
      <div class="span-8">
        <LabeledSelect
          v-model:value="selectedSubnetId"
          :options="subnetOptions"
          label-key="capa.machineConfig.instanceConfiguration.subnet.label"
          option-key="value"
          option-label="label"
          :mode="mode"
          :loading="loadingSubnets"
        />
      </div>
      <div>
        <div class="span-4">
          <LabeledSelect
            v-model:value="modelInstanceMetadataHttpTokens"
            :options="httpTokensOptions"
            label-key="capa.machineConfig.instanceConfiguration.advanced.instanceMetadataOptions.httpTokens.label"
            :mode="mode"
          />
        </div>
        <p class="text-muted text-small mmt-2 mb-0">
          {{ t('capa.machineConfig.instanceConfiguration.advanced.instanceMetadataOptions.httpTokens.description') }}
        </p>
      </div>
    </RcSection>
    </RcSection>
</template>
