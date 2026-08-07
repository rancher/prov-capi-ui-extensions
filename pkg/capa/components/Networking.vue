<script setup lang="ts">
import { toRefs, ref, watch, computed } from 'vue';
import { useVeeValidateField } from '@shell/composables/useVeeValidateField';
import { useStore } from 'vuex';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import RadioGroup from '@components/Form/Radio/RadioGroup.vue';
import { useI18n } from '@shell/composables/useI18n';
import { _CREATE } from '@shell/config/query-params';
import { RcSection } from '@components/RcSection';
import { getSubnetDisplayName, getVpcDisplayName } from '@shell/utils/aws';
import * as AWS from '@shell/types/aws-sdk';
import Checkbox from '@components/Form/Checkbox/Checkbox.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import IngressRules from './IngressRules.vue';
import SecurityOverrides from './SecurityOverrides.vue';
import Banner from '@components/Banner/Banner.vue';
import { isCapaManagedVpcId } from '../utils';
import { CNI_INGRESS_RULES } from './constants';
import { scrollToBottom } from '@shell/utils/scroll';
import type { IngressRule, CNIIngressRule, SubnetSpec, SecurityGroupRole } from '../types/capa';
import { isEqual } from '@shell/utils/object';

defineOptions({ name: 'Networking' });

const emit = defineEmits([
  'update:vpcId',
  'update:subnets',
  'validationChanged',
  'update:ipv6',
  'update:cidrBlock',
  'update:securityGroupOverrides',
  'update:additionalControlPlaneIngressRules',
  'update:additionalNodeIngressRules',
  'update:cniIngressRules',
  'update:useUnmanagedNetwork'
]);

interface Props {
  vpcId: string;
  subnets: SubnetSpec[];
  cidrBlock?: string;
  ipv6?: {} | null;
  mode?: string;
  securityGroupOverrides?: Partial<Record<SecurityGroupRole, string>>;
  additionalControlPlaneIngressRules?: IngressRule[];
  additionalNodeIngressRules?: IngressRule[];
  cniIngressRules?: CNIIngressRule[];
  vpcInfo?: AWS.VPC[];
  subnetInfo?: AWS.Subnet[];
  securityGroupInfo?: AWS.SecurityGroup[];
  loadingVpcs?: boolean;
  loadingSubnets?: boolean;
  loadingSecurityGroups?: boolean;
  useUnmanagedNetwork?: boolean;
  provisioningCluster?: any;
  vpcValidators?: Array<(val: unknown) => string | undefined>;
  subnetValidators?: Array<(val: unknown) => string | undefined>;
  cidrBlockValidators?: Array<(val: unknown) => string | undefined>;
  additionalControlPlaneIngressRulesValidators?: Array<(val: unknown) => string | undefined>;
  additionalNodeIngressRulesValidators?: Array<(val: unknown) => string | undefined>;
}

const props = withDefaults(defineProps<Props>(), {
  mode:                                         _CREATE,
  ipv6:                                         null,
  cidrBlock:                                    '',
  securityGroupOverrides:                       () => ({}),
  additionalControlPlaneIngressRules:           () => [],
  additionalNodeIngressRules:                   () => [],
  cniIngressRules:                              () => [],
  vpcInfo:                                      () => [],
  subnetInfo:                                   () => [],
  securityGroupInfo:                            () => [],
  loadingVpcs:                                  false,
  loadingSubnets:                               false,
  loadingSecurityGroups:                        false,
  useUnmanagedNetwork:                          false,
  provisioningCluster:                          {},
  vpcValidators:                                () => [],
  subnetValidators:                             () => [],
  cidrBlockValidators:                          () => [],
  additionalControlPlaneIngressRulesValidators: () => [],
  additionalNodeIngressRulesValidators:         () => [],
});

const {
  vpcId, subnets, ipv6, cidrBlock,
  mode, securityGroupOverrides, additionalControlPlaneIngressRules, additionalNodeIngressRules, cniIngressRules,
  vpcInfo, subnetInfo, securityGroupInfo, loadingVpcs, loadingSubnets, loadingSecurityGroups, useUnmanagedNetwork, provisioningCluster,
  vpcValidators, subnetValidators, cidrBlockValidators,
  additionalControlPlaneIngressRulesValidators, additionalNodeIngressRulesValidators,
} = toRefs(props);

const store = useStore();
const { t } = useI18n(store);

// Register these array-valued fields with the parent useFormValidation form context so that
// isFormValid reflects CIDR validation errors. Per-input error display is handled by IngressRules
// via the useLabeledFormElement rules path (independent of vee-validate).
useVeeValidateField({
  name:              ref('additionalControlPlaneIngressRules'),
  rules:             additionalControlPlaneIngressRulesValidators,
  value:             computed(() => JSON.stringify(additionalControlPlaneIngressRules.value)),
  validationMessage: ref(null),
});

useVeeValidateField({
  name:              ref('additionalNodeIngressRules'),
  rules:             additionalNodeIngressRulesValidators,
  value:             computed(() => JSON.stringify(additionalNodeIngressRules.value)),
  validationMessage: ref(null),
});

const allowAdditionalCPRules = computed(() => !(securityGroupOverrides.value)?.controlplane);
const allowAdditionalNodeRules = computed(() => !(securityGroupOverrides.value)?.node);
const allowCNIRules = computed(() => allowAdditionalNodeRules.value || allowAdditionalCPRules.value);

const storedCPIngressRules = ref<IngressRule[]>([]);
const storedNodeIngressRules = ref<IngressRule[]>([]);
const storedCNIIngressRules = ref<CNIIngressRule[]>([]);

const provClusterCNI = computed(() => {
  return provisioningCluster?.value?.spec?.rkeConfig?.machineGlobalConfig?.cni;
});

const selectedSubnetIds = computed({
  get: () => (subnets.value || []).map((s) => s.id),
  set: (ids: string[]) => {
    emit('update:subnets', ids.map((id) => ({ id })));
  }
});

const enableIpv6 = computed({
  get() {
    return !!ipv6?.value;
  },
  set(value: boolean) {
    if (value) {
      emit('update:ipv6', {});
    } else {
      emit('update:ipv6', undefined);
    }
  }
});

const networkStrategyOptions = [
  {
    label:       t('capa.clusterConfig.network.strategy.managed.label'),
    value:       false,
    description: t('capa.clusterConfig.network.strategy.managed.description')
  },
  {
    label:       t('capa.clusterConfig.network.strategy.unmanaged.label'),
    value:       true,
    description: t('capa.clusterConfig.network.strategy.unmanaged.description')
  }
];

const vpcOptions = computed(() => {
  if (!vpcInfo.value) {
    return [];
  }

  return vpcInfo.value.map((v) => {
    return { label: getVpcDisplayName(v), value: v.VpcId };
  });
});

const subnetOptions = computed(() => {
  if (!subnetInfo.value) {
    return [];
  }

  return subnetInfo.value.reduce((opts, s) => {
    if (vpcId.value && s.VpcId !== vpcId.value ) {
      return opts;
    }
    opts.push( { label: getSubnetDisplayName(s), value: s.SubnetId });

    return opts;
  }, [] as {label: string, value: string}[]);
});

const isCreate = computed(() => {
  return mode.value === _CREATE;
});

function goToBasicsCniSelect(e: MouseEvent) {
  if ((e?.target as HTMLElement)?.localName === 'a') {
    setTimeout(() => {
      // timeout allows the basic tab to render before scrolling
      scrollToBottom();
    }, 3);
  }
}

// clear out vpcid and subnets if the radio group changes the value of useUnmanagedNetwork
// this avoids clearing out vpcid/subnets aws set when useUnmanagedNetwork is initialized on edit
function userUpdatedUnamangedNetwork(neu: boolean) {
  if (!neu) {
    emit('update:vpcId', null);
    emit('update:subnets', null);
  }
  emit('update:useUnmanagedNetwork', neu);
}

watch(vpcId, () => {
  emit('update:subnets', []);
  const cpRules = (additionalControlPlaneIngressRules.value || []).map((r: IngressRule) => {
    const { sourceSecurityGroupIDs, ...rest } = r;

    return sourceSecurityGroupIDs ? rest : r;
  });

  emit('update:additionalControlPlaneIngressRules', cpRules);
  const nodeRules = (additionalNodeIngressRules.value || []).map((r: IngressRule) => {
    const { sourceSecurityGroupIDs, ...rest } = r;

    return sourceSecurityGroupIDs ? rest : r;
  });

  emit('update:additionalNodeIngressRules', nodeRules);
});

watch(vpcOptions, () => {
  // if users select 'managed networks' the UI will leave vpcId empty and CAPA will populate vpcId
  // on edit, we have to look at the VPC definition to see if its was created by CAPA to know if UI should show 'managed networks' or 'unmanaged networks' selected
  if (vpcId.value && vpcInfo.value) {
    emit('update:useUnmanagedNetwork', !isCapaManagedVpcId(vpcId.value, vpcInfo.value));
  }
});

watch(allowAdditionalCPRules, (allowed) => {
  if (!allowed) {
    storedCPIngressRules.value = [...(additionalControlPlaneIngressRules.value || [])];
    emit('update:additionalControlPlaneIngressRules', []);
  } else if (storedCPIngressRules.value.length) {
    emit('update:additionalControlPlaneIngressRules', storedCPIngressRules.value);
    storedCPIngressRules.value = [];
  }
});

watch(allowAdditionalNodeRules, (allowed) => {
  if (!allowed) {
    storedNodeIngressRules.value = [...(additionalNodeIngressRules.value || [])];
    emit('update:additionalNodeIngressRules', []);
  } else if (storedNodeIngressRules.value.length) {
    emit('update:additionalNodeIngressRules', storedNodeIngressRules.value);
    storedNodeIngressRules.value = [];
  }
});

watch(allowCNIRules, (allowed) => {
  if (!allowed) {
    storedCNIIngressRules.value = [...(cniIngressRules.value || [])];
    emit('update:cniIngressRules', []);
  } else if (storedCNIIngressRules.value.length) {
    emit('update:cniIngressRules', storedCNIIngressRules.value);
    storedCNIIngressRules.value = [];
  }
});

watch(provClusterCNI, (newCni = '', oldCni = '') => {
  // if the CNI ingress rules ui is currently hidden because its overriden, update stored values so rules are correct if overrides are removed
  const source = allowCNIRules.value ? cniIngressRules.value : storedCNIIngressRules.value;
  const currentRules = [...(source || [])];

  // match cni options that include multus, eg "multus, calico" should use calico rules
  const oldCNIKey = Object.keys(CNI_INGRESS_RULES).find((k) => oldCni.includes(k));
  // Remove rules matching the old CNI
  const oldRules = oldCNIKey ? (CNI_INGRESS_RULES as Record<string, CNIIngressRule[]>)[oldCNIKey] || [] : [];
  const filtered = currentRules.filter((rule) => {
    return !oldRules.some((oldRule) => isEqual(oldRule, rule));
  });

  const newCNIKey = Object.keys(CNI_INGRESS_RULES).find((k) => newCni.includes(k));
  // Add rules for the new CNI
  const newRules = newCNIKey ? (CNI_INGRESS_RULES as Record<string, CNIIngressRule[]>)[newCNIKey] || [] : [];
  const updated = [...filtered, ...newRules];

  if (allowCNIRules.value) {
    emit('update:cniIngressRules', updated);
  } else {
    storedCNIIngressRules.value = updated;
  }
}, { immediate: true });
</script>

<template>
  <RadioGroup
    :value="useUnmanagedNetwork"
    :label="t('capa.clusterConfig.network.strategy.label')"
    name="network-strategy"
    :options="networkStrategyOptions"
    :mode="mode"
    :disabled="!isCreate"
    @update:value="userUpdatedUnamangedNetwork"
  />

  <RcSection
    v-if="useUnmanagedNetwork"
    :title="t('capa.clusterConfig.network.unmanagedSettings.title')"
    type="secondary"
    mode="with-header"
    :expandable="true"
  >
    <div class="span-6 mmb-4">
      <LabeledSelect
        :value="vpcId"
        :label="t('capa.clusterConfig.network.vpc.label')"
        :options="vpcOptions"
        :loading="loadingVpcs"
        :sub-label="t('capa.clusterConfig.network.vpc.description')"
        name="vpc"
        :rules="vpcValidators"
        required
        :disabled="!isCreate"
        @update:value="$emit('update:vpcId', $event)"
      />
    </div>
    <div class="span-6 mmb-6">
      <LabeledSelect
        v-model:value="selectedSubnetIds"
        :label="t('capa.clusterConfig.network.subnets.label')"
        :sub-label="t('capa.clusterConfig.network.subnets.description')"
        :options="subnetOptions"
        :loading="loadingSubnets"
        :multiple="true"
        required
        name="subnet"
        :rules="subnetValidators"
      />
    </div>
  </RcSection>
  <div
    v-else
    class="row mmb-4"
  >
    <div class="col span-6">
      <LabeledInput
        :value="cidrBlock"
        :label="t('capa.clusterConfig.network.vpc.cidrBlock.label')"
        :placeholder="t('capa.clusterConfig.network.vpc.cidrBlock.placeholder')"
        :sub-label="t('capa.clusterConfig.network.vpc.cidrBlock.description')"
        :mode="mode"
        name="cidrBlock"
        :rules="cidrBlockValidators"
        :disabled="!isCreate"
        @update:value="$emit('update:cidrBlock', $event)"
      />
    </div>
  </div>
  <div class="row">
    <Checkbox
      v-model:value="enableIpv6"
      :mode="mode"
      :label="t('capa.clusterConfig.network.enableIpv6')"
    />
  </div>
  <RcSection
    :title="t('capa.clusterConfig.network.networkSecurity.title')"
    :expandable="true"
    mode="with-header"
    type="secondary"
    :expanded="false"
  >
    <Banner
      color="warning"
      class="m-0"
      @click="goToBasicsCniSelect"
    >
      <span v-clean-html="t('capa.clusterConfig.network.cniProviderBanner', { cni: provClusterCNI }, true)" />
    </Banner>
    <RcSection
      v-if="useUnmanagedNetwork"
      :title="t('capa.clusterConfig.network.securityGroups.label')"
      :expandable="true"
      mode="with-header"
      type="secondary"
    >
      <h5>{{ t('capa.clusterConfig.network.securityGroups.description') }}</h5>
      <SecurityOverrides
        :value="securityGroupOverrides"
        :vpc-id="vpcId"
        :security-group-info="securityGroupInfo"
        :loading-security-groups="loadingSecurityGroups"
        :mode="mode"

        @update:value="$emit('update:securityGroupOverrides', $event)"
      />
    </RcSection>

    <RcSection
      :title="t('capa.clusterConfig.network.additionalControlPlaneIngressRules.label')"
      :expandable="true"
      mode="with-header"
      type="secondary"
    >
      <h5>{{ t('capa.clusterConfig.network.additionalControlPlaneIngressRules.description') }}</h5>
      <IngressRules
        v-if="allowAdditionalCPRules"
        :value="additionalControlPlaneIngressRules"
        :mode="mode"
        :vpc-id="vpcId"
        :security-group-info="securityGroupInfo"
        :loading-security-groups="loadingSecurityGroups"
        :disable-add="!allowAdditionalCPRules"
        :validators="additionalControlPlaneIngressRulesValidators"
        :title-prefix="t('capa.clusterConfig.network.additionalControlPlaneIngressRules.ruleSectionTitlePrefix')"
        @update:value="$emit('update:additionalControlPlaneIngressRules', $event)"
      />
      <Banner
        v-else
        color="info"
        class="m-0"
      >
        {{ t('capa.clusterConfig.network.overrideBanners.controlPlaneOverridden') }}
      </Banner>
    </RcSection>

    <RcSection
      :title="t('capa.clusterConfig.network.additionalNodeIngressRules.label')"
      :expandable="true"
      mode="with-header"
      type="secondary"
    >
      <h5>{{ t('capa.clusterConfig.network.additionalNodeIngressRules.description') }}</h5>
      <IngressRules
        v-if="allowAdditionalNodeRules"
        :value="additionalNodeIngressRules"
        :mode="mode"
        :vpc-id="vpcId"
        :security-group-info="securityGroupInfo"
        :loading-security-groups="loadingSecurityGroups"
        :disable-add="!allowAdditionalNodeRules"
        :title-prefix="t('capa.clusterConfig.network.additionalNodeIngressRules.ruleSectionTitlePrefix')"
        @update:value="$emit('update:additionalNodeIngressRules', $event)"
      />
      <Banner
        v-else
        color="info"
        class="m-0"
      >
        {{ t('capa.clusterConfig.network.overrideBanners.nodeOverridden') }}
      </Banner>
    </RcSection>

    <RcSection
      :title="t('capa.clusterConfig.network.cniIngressRules.label')"
      :expandable="true"
      mode="with-header"
      type="secondary"
    >
      <Banner
        v-if="!allowAdditionalNodeRules && allowCNIRules"
        color="info"
        class="m-0"
      >
        {{ t('capa.clusterConfig.network.overrideBanners.nodeOverriddenCni') }}
      </Banner>
      <Banner
        v-if="!allowAdditionalCPRules && allowCNIRules"
        color="info"
        class="m-0"
      >
        {{ t('capa.clusterConfig.network.overrideBanners.controlPlaneOverriddenCni') }}
      </Banner>
      <h5>{{ t('capa.clusterConfig.network.cniIngressRules.description') }}</h5>
      <IngressRules
        v-if="allowCNIRules"
        :value="cniIngressRules"
        :mode="mode"
        :vpc-id="vpcId"
        :security-group-info="securityGroupInfo"
        :loading-security-groups="loadingSecurityGroups"
        :title-prefix="t('capa.clusterConfig.network.cniIngressRules.ruleSectionTitlePrefix')"
        :allow-targets="false"
        @update:value="$emit('update:cniIngressRules', $event)"
      />
      <Banner
        v-else
        color="info"
        class="m-0"
      >
        {{ t('capa.clusterConfig.network.overrideBanners.bothOverridden') }}
      </Banner>
    </RcSection>
  </RcSection>
</template>
