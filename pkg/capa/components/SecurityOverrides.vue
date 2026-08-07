
<script setup lang="ts">
import {
  toRefs, ref, watch, computed, nextTick
} from 'vue';
import { _CREATE } from '@shell/config/query-params';
import * as AWS from '@shell/types/aws-sdk';
import { useStore } from 'vuex';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { useI18n } from '@shell/composables/useI18n';
import KeyValue from '@shell/components/form/KeyValue.vue';
import ButtonDropdown from '@shell/components/ButtonDropdown.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import { SECURITY_GROUP_ROLES } from './constants';
import type { SecurityGroupRole } from '../types/capa';

defineOptions({ name: 'SecurityGroupOverrides' });

const emit = defineEmits([
  'update:value',
]);

interface Props {
  vpcId: string;
  value: Partial<Record<SecurityGroupRole, string>>;
  mode?: string;
  securityGroupInfo?: AWS.SecurityGroup[];
  loadingSecurityGroups?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode:                  _CREATE,
  securityGroupInfo:     () => [],
  loadingSecurityGroups: false,
});

const {
  vpcId, value, securityGroupInfo, loadingSecurityGroups
} = toRefs(props);

const store = useStore();
const { t } = useI18n(store);
const localValue = ref({ ...value.value });
let updatingFromProp = false;

const securityGroupOptions = computed(() => {
  if (!vpcId.value) {
    return [];
  }

  return securityGroupInfo.value.reduce((opts, sg) => {
    if (sg.VpcId === vpcId.value) {
      opts.push({ label: `${ sg.GroupName } (${ sg.Description })`, value: sg.GroupId });
    }

    return opts;
  }, [] as {label:string, value: string}[]);
});

const securityGroupRoleOptions = computed(() => {
  const inUse = Object.keys(localValue.value || {}).filter((r) => !!localValue.value[r]);

  return SECURITY_GROUP_ROLES.filter((r) => !inUse.includes(r)).map((r) => {
    return { label: t(`capa.clusterConfig.network.securityGroups.roles.${ r }`), value: r };
  });
});

function getRoleLabel(role: string) {
  return t(`capa.clusterConfig.network.securityGroups.roles.${ role }`);
}

function updateRowValue(key: string, newValue: string) {
  localValue.value = {
    ...localValue.value,
    [key]: newValue
  };
}

function addOverride(targetRole: string) {
  // Create a new object to ensure reactivity triggers
  localValue.value = {
    ...localValue.value,
    [targetRole]: securityGroupOptions.value[0]?.value || ''
  };
}

function updateOverrides(neu: Record<string, string>) {
  // Create a new object reference to ensure reactivity
  localValue.value = { ...neu };
}

watch(vpcId, (neu, old) => {
  if (old) {
    localValue.value = Object.fromEntries(Object.keys(localValue.value).map((k) => [k, '']));
  }
});

watch(value, (neu) => {
  // need to track when localValue is updated by the value prop changing (eg security groups cleared out when region/vpc changes in another component)
  // to avoid a loop where the localValue watcher triggers the value watcher triggers the localValue watcher etc
  // setting this back to false in nextTick ensures that when this watcher triggers the localValue watcher initially, updatingFromProp is true and localValue watcher's emit is skipped
  // but subsequent runs triggered by the user updating localValue through form interactions trigger the emit
  updatingFromProp = true;
  localValue.value = { ...neu };
  nextTick(() => {
    updatingFromProp = false;
  });
}, { deep: true });

watch(localValue, (neu) => {
  if (updatingFromProp) return;
  emit('update:value', neu);
});

</script>

<template>
  <div
    v-if="Object.keys(localValue || {}).length"
  >
    <KeyValue
      :value="localValue"
      :mode="mode"
      :add-allowed="false"
      :read-allowed="false"
      :key-label="t('capa.clusterConfig.network.securityGroups.role')"
      :value-label="t('capa.clusterConfig.network.securityGroups.securityGroupId')"
      @update:value="updateOverrides"
    >
      <template #key="{row}">
        <LabeledInput
          class="display-role"
          disabled
          :value="getRoleLabel(row.key)"
          :mode="mode"
        />
      </template>
      <template #value="{row}">
        <LabeledSelect
          :value="row.value"
          :options="securityGroupOptions"
          :loading="loadingSecurityGroups"
          :disabled="!vpcId"
          :placeholder="!vpcId ? t('capa.clusterConfig.network.securityGroups.selectVpc'): ''"
          :mode="mode"
          @update:value="(newValue: string) => updateRowValue(row.key, newValue)"
        />
      </template>
    </KeyValue>
  </div>
  <div class="row">
    <ButtonDropdown
      v-if="securityGroupRoleOptions.length"
      :button-label="t('capa.clusterConfig.network.securityGroups.addOverride')"
      :dropdown-options="securityGroupRoleOptions"
      size="sm"
      class="btn btn-sm role-secondary"
      @click-action="(e: {value: string})=>addOverride(e.value)"
    />
  </div>
</template>

<style lang="scss" scoped>
// force the role input to match height of the security group select - KV appears to be forcing this height
.display-role {
  min-height: $unlabeled-input-height;
  padding: 10px;
}
// ensure that both items are the same width
:deep(.kv-item.key),
:deep(.kv-item.value) {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

</style>
