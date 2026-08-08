<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { RcSection } from '@components/RcSection';
import ArrayList from '@shell/components/form/ArrayList.vue';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import UnitInput from '@shell/components/form/UnitInput';
import { Checkbox } from '@components/Form/Checkbox';
import { MACHINE_CONFIG_DEFAULTS, NON_ROOT_VOLUME_DEFAULT, VOLUME_TYPE_OPTIONS } from './constants';
import { _CREATE } from '@shell/config/query-params';

defineOptions({ name: 'StorageSection' });

type Validator = (val: unknown) => string | undefined;

interface Props {
  rootVolumeSize?: number;
  rootVolumeType?: string;
  rootVolumeEncrypted?: boolean;
  rootVolumeEncryptionKey?: string | null;
  nonRootVolumes?: Record<string, any>[];
  rootVolumeTypeOptions?: { label: string; value: string }[];
  mode?: string;
  loadingKmsKeys?: boolean;
  kmsKeys?: Record<string, any>[];
  rules?: Record<string, Validator[]>;
}

const emit = defineEmits([
  'update:rootVolumeSize',
  'update:rootVolumeType',
  'update:rootVolumeEncrypted',
  'update:rootVolumeEncryptionKey',
  'update:nonRootVolumes',
]);

const props = withDefaults(defineProps<Props>(), {
  rootVolumeSize:          MACHINE_CONFIG_DEFAULTS.rootVolume.size,
  rootVolumeType:          MACHINE_CONFIG_DEFAULTS.rootVolume.type,
  rootVolumeEncrypted:     MACHINE_CONFIG_DEFAULTS.rootVolume.encrypted,
  rootVolumeEncryptionKey: null,
  nonRootVolumes:          () => [],
  rootVolumeTypeOptions:   () => VOLUME_TYPE_OPTIONS,
  mode:                    _CREATE,
  loadingKmsKeys:          false,
  kmsKeys:                 () => [],
  rules:                   () => ({}),
});

const store = useStore();
const { t } = useI18n(store);

const modelRootVolumeSize = computed({
  get: () => props.rootVolumeSize ?? MACHINE_CONFIG_DEFAULTS.rootVolume.size,
  set: (val: number) => emit('update:rootVolumeSize', val),
});

const modelRootVolumeType = computed({
  get: () => props.rootVolumeType || MACHINE_CONFIG_DEFAULTS.rootVolume.type,
  set: (val: string) => emit('update:rootVolumeType', val),
});

const modelRootVolumeEncrypted = computed({
  get: () => !!props.rootVolumeEncrypted,
  set: (val: boolean) => emit('update:rootVolumeEncrypted', val),
});

const modelRootVolumeEncryptionKey = computed({
  get: () => props.rootVolumeEncryptionKey || '',
  set: (val: string) => emit('update:rootVolumeEncryptionKey', val),
});

const modelNonRootVolumes = computed({
  get: () => props.nonRootVolumes || [],
  set: (val: Record<string, any>[]) => emit('update:nonRootVolumes', val),
});

const kmsKeyOptions = computed(() => {
  return (props.kmsKeys || [])
    .map((keyPair: Record<string, any>) => ({ label: keyPair.KeyArn, value: keyPair.KeyId }))
    .filter((key: { label: string; value: string } | undefined): key is { label: string; value: string } => !!key);
});
const additionalVolumeTypeOptions = computed(() => VOLUME_TYPE_OPTIONS);
</script>

<template>
  <RcSection
    :title="t('capa.machineConfig.storage.title')"
    :expandable="true"
    mode="with-header"
    type="primary"
  >
    <p>{{ t('capa.machineConfig.storage.description') }}</p>

    <div class="row">
      <div class="span-4 mmr-4">
        <UnitInput
          v-model:value="modelRootVolumeSize"
          name="rootVolumeSize"
          :rules="rules.rootVolumeSize"
          label-key="capa.machineConfig.storage.rootVolume.size.label"
          suffix="GiB"
          class="mmr-4"
          required
          :mode="mode"
        />
      </div>
      <div class="span-4">
        <LabeledSelect
          v-model:value="modelRootVolumeType"
          name="rootVolumeType"
          :rules="rules.rootVolumeType"
          :options="rootVolumeTypeOptions"
          label-key="capa.machineConfig.storage.rootVolume.type.label"
          required
          :mode="mode"
        />
      </div>
    </div>

    <Checkbox
      v-model:value="modelRootVolumeEncrypted"
      :mode="mode"
      :label="t('capa.machineConfig.storage.rootVolume.encrypted.label')"
    />
    <div
      v-if="modelRootVolumeEncrypted"
      class="span-8"
    >
      <LabeledSelect
        v-model:value="modelRootVolumeEncryptionKey"
        name="rootVolumeEncryptionKey"
        :rules="rules.rootVolumeEncryptionKey"
        :options="kmsKeyOptions"
        label-key="capa.machineConfig.storage.rootVolume.encryptionKey.label"
        placeholder-key="capa.machineConfig.storage.rootVolume.encryptionKey.placeholder"
        required
        :mode="mode"
        :loading="loadingKmsKeys"
      />
    </div>
    <RcSection
      :title="t('capa.machineConfig.storage.advanced.title')"
      :expandable="true"
      mode="with-header"
      type="secondary"
      :expanded="false"
    >
      <ArrayList
        v-model:value="modelNonRootVolumes"
        :add-allowed="true"
        :default-add-value="NON_ROOT_VOLUME_DEFAULT"
        :add-label="t('capa.machineConfig.storage.advanced.additionalVolumes.add')"
        :show-header="true"
        class="mmb-4 additional-volumes-list"
        :mode="mode"
      >
        <template #columns="{ row, queueUpdate }">
          <div class="additional-volumes-grid">
            <LabeledInput
              v-model:value="row.value.deviceName"
              label-key="capa.machineConfig.storage.advanced.additionalVolumes.deviceName.label"
              class="additional-volume-field"
              :mode="mode"
              @update:value="queueUpdate"
            />
            <LabeledSelect
              v-model:value="row.value.type"
              :options="additionalVolumeTypeOptions"
              label-key="capa.machineConfig.storage.advanced.additionalVolumes.type.label"
              class="additional-volume-field"
              :mode="mode"
              @update:value="queueUpdate"
            />
            <UnitInput
              v-model:value="row.value.size"
              label-key="capa.machineConfig.storage.advanced.additionalVolumes.size.label"
              class="additional-volume-field"
              :mode="mode"
              suffix="GiB"
              @update:value="queueUpdate"
            />
          </div>
        </template>
      </ArrayList>
    </RcSection>
  </RcSection>
</template>

<style lang="scss" scoped>
.additional-volumes-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}

.additional-volume-field {
  min-width: 0;
}

@media (max-width: 1024px) {
  .additional-volumes-grid {
    grid-template-columns: 1fr;
  }
}
</style>
