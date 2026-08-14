<script setup lang="ts">
import { toRefs, computed, ref } from 'vue';
import { _CREATE } from '@shell/config/query-params';
import { useStore } from 'vuex';
import * as AWS from '@shell/types/aws-sdk';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import LabeledInput from '@components/Form/LabeledInput/LabeledInput.vue';
import RcSection from '@components/RcSection/RcSection.vue';
import RcSectionActions from '@components/RcSection/RcSectionActions.vue';
import { useI18n } from '@shell/composables/useI18n';
import { removeEmptyFields } from '../utils';
import { SECURITY_GROUP_ROLES } from './constants';
import * as cidrValidators from '../validators';
import Checkbox from '@components/Form/Checkbox/Checkbox.vue';
import type { IngressRule, SecurityGroupProtocol } from '../types/capa';

defineOptions({ name: 'IngressRules' });

const emit = defineEmits(['update:value']);

interface Props {
  value: IngressRule[];
  mode?: string;
  vpcId?: string;
  securityGroupInfo?: AWS.SecurityGroup[];
  loadingSecurityGroups?: boolean;
  allowTargets?: boolean;
  titlePrefix?: string;
  disableAdd?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode:                  _CREATE,
  value:                 () => [],
  vpcId:                 '',
  securityGroupInfo:     () => [],
  loadingSecurityGroups: false,
  allowTargets:          true,
  titlePrefix:           '',
  disableAdd:            false,
});

const {
  value, mode, vpcId, securityGroupInfo, loadingSecurityGroups, allowTargets
} = toRefs(props);

const store = useStore();
const { t } = useI18n(store);

const SECURITY_GROUP_ROLE_OPTIONS = computed(() => SECURITY_GROUP_ROLES.map((r) => ({ label: t(`capa.clusterConfig.network.securityGroups.roles.${ r }`), value: r })));

const PROTOCOLS = computed(() => [
  { label: t('capa.clusterConfig.network.ingressRules.protocols.all'), value: '-1' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.tcp'), value: 'tcp' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.udp'), value: 'udp' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.icmp'), value: 'icmp' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.icmpv6'), value: '58' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.ipInIp'), value: '4' },
  { label: t('capa.clusterConfig.network.ingressRules.protocols.esp'), value: '50' }
]);

const defaultRule: IngressRule = {
  description: '',
  protocol:    'tcp' as SecurityGroupProtocol,
};

const defaultRuleWithTargets: IngressRule = {
  ...defaultRule,
  cidrBlocks:               [],
  sourceSecurityGroupIDs:   [],
  sourceSecurityGroupRoles: []
};

const localValue = computed({
  get: () => value.value || [],
  set: (neu) => {
    emit('update:value', neu);
  }
});

const securityGroupOptions = computed(() => {
  return securityGroupInfo.value.reduce((opts, sg) => {
    if (!vpcId.value || sg.VpcId === vpcId.value) {
      opts.push({
        label: `${ sg.GroupName } (${ sg.GroupId })`,
        value: sg.GroupId
      });
    }

    return opts;
  }, [] as any);
});

function addRule() {
  const rules = [...localValue.value];
  const newRule = allowTargets.value ? defaultRuleWithTargets : defaultRule;

  rules.push({ ...newRule });
  localValue.value = rules;
}

function removeRule(index: number) {
  const rules = [...localValue.value];

  rules.splice(index, 1);
  localValue.value = rules;
}

function updateRule(index: number, field: string, newValue: any) {
  const rules = [...localValue.value];

  // remove empty arrays of security groups to pass be validation
  rules[index] = removeEmptyFields({ ...rules[index], [field]: newValue });
  localValue.value = rules;
}

function updateCidrString(index: number, field: string, stringValue: string) {
  const rules = [...localValue.value];
  const arrayValue = getCidrArray(stringValue);

  rules[index] = removeEmptyFields({ ...rules[index], [field]: arrayValue });
  localValue.value = rules;
}

function getCidrString(cidrArray: string[]): string {
  return (cidrArray || []).join(', ');
}

// Track the raw string the user is typing in each rule's CIDR inputs.
// Without this the input handler will try to parse the comma-separated list into cidr blocks, stripping trailing commas and
// making it impossible to type a comma-separated list of CIDRs
const localCidr = ref<Record<number, string>>({});
const localIpv6Cidr = ref<Record<number, string>>({});

function getLocalCidrValue(index: number, cidrArray: string[] = []): string {
  return index in localCidr.value ? localCidr.value[index] : getCidrString(cidrArray);
}

function getLocalIpv6CidrValue(index: number, cidrArray: string[] = []): string {
  return index in localIpv6Cidr.value ? localIpv6Cidr.value[index] : getCidrString(cidrArray);
}

function handleCidrInput(index: number, stringValue: string) {
  localCidr.value = { ...localCidr.value, [index]: stringValue };
}

function handleIpv6CidrInput(index: number, stringValue: string) {
  localIpv6Cidr.value = { ...localIpv6Cidr.value, [index]: stringValue };
}

function updateCidrFromLocalValue(index: number) {
  const local = localCidr.value[index];

  if (local !== undefined) {
    updateCidrString(index, 'cidrBlocks', local);
    const { [index]: _, ...rest } = localCidr.value;

    localCidr.value = rest;
  }
}

function updateIpv6CidrFromLocalValue(index: number) {
  const local = localIpv6Cidr.value[index];

  if (local !== undefined) {
    updateCidrString(index, 'ipv6CidrBlocks', local);
    const { [index]: _, ...rest } = localIpv6Cidr.value;

    localIpv6Cidr.value = rest;
  }
}

function getCidrArray(cidrString: string) {
  return cidrString
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function allowCidr(rule: IngressRule) {
  if (rule.natGatewaysIPsSource) return false;
  const { cidrBlocks = [], sourceSecurityGroupIDs = [], sourceSecurityGroupRoles = [] } = rule;

  return (!sourceSecurityGroupIDs.length && !sourceSecurityGroupRoles.length) || cidrBlocks.length;
}

function allowSecurityGroups(rule: IngressRule) {
  if (rule.natGatewaysIPsSource) return false;
  const { cidrBlocks = [], sourceSecurityGroupIDs = [], ipv6CidrBlocks = [] } = rule;

  return sourceSecurityGroupIDs.length || (!!vpcId.value && !cidrBlocks.length && !ipv6CidrBlocks.length);
}

function allowSecurityGroupRoles(rule: IngressRule) {
  if (rule.natGatewaysIPsSource) return false;
  const { cidrBlocks = [], sourceSecurityGroupRoles = [], ipv6CidrBlocks = [] } = rule;

  return (!cidrBlocks.length && !ipv6CidrBlocks.length) || sourceSecurityGroupRoles.length;
}

function allowNatGatewaysIPsSource(rule: IngressRule) {
  const {
    cidrBlocks = [], sourceSecurityGroupIDs = [], sourceSecurityGroupRoles = [], ipv6CidrBlocks = []
  } = rule;

  return !cidrBlocks.length && !ipv6CidrBlocks.length && !sourceSecurityGroupIDs.length && !sourceSecurityGroupRoles.length;
}

function validateCidrString(cidrBlockString = '') {
  const blocks = getCidrArray(cidrBlockString);

  return cidrValidators.ipv4CidrBlocks(t, blocks);
}

function validateIpv6CidrString(cidrBlockString = '') {
  const blocks = getCidrArray(cidrBlockString);

  return cidrValidators.ipv6CidrBlocks(t, blocks);
}
</script>

<template>
  <div class="ingress-rules">
    <RcSection
      v-for="(rule, index) in localValue"
      :key="index"
      type="secondary"
      mode="with-header"
      :expandable="false"
      :title="titlePrefix ? t('capa.clusterConfig.network.ingressRules.ruleTitle', {index:index+1, titlePrefix}) : ''"
    >
      <template #actions>
        <RcSectionActions
          :actions="[
            { icon: 'trash', ariaLabel: t('capa.clusterConfig.network.ingressRules.deleteRule'), action: () => removeRule(index) },
          ]"
        />
      </template>
      <div>
        <div class="rule-row">
          <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.description') }}</label>
        </div>
        <div class="rule-row">
          <LabeledInput
            :value="rule.description"
            :mode="mode"
            @update:value="updateRule(index, 'description', $event)"
          />
        </div>
      </div>

      <div>
        <div
          class="rule-row"
        >
          <div class="short-col">
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.protocol') }}</label>
          </div>
          <div class="short-col">
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.fromPort') }}</label>
          </div>
          <div class="short-col">
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.toPort') }}</label>
          </div>
          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.sourceSecurityGroupIDs') }}</label>
          </div>
          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.sourceSecurityGroupRoles') }}</label>
          </div>
        </div>
        <div class="rule-row">
          <div class="short-col">
            <LabeledSelect
              :value="rule.protocol"
              :mode="mode"
              :options="PROTOCOLS"
              @update:value="updateRule(index, 'protocol', $event)"
            />
          </div>
          <div class="short-col">
            <LabeledInput
              :value="rule.fromPort"
              :mode="mode"
              @update:value="updateRule(index, 'fromPort', parseInt($event) || 0)"
            />
          </div>
          <div class="short-col">
            <LabeledInput
              :value="rule.toPort"
              :mode="mode"
              @update:value="updateRule(index, 'toPort', parseInt($event) || 0)"
            />
          </div>

          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <LabeledSelect
              :disabled="!allowSecurityGroups(rule)"
              :value="rule.sourceSecurityGroupIDs || []"
              :mode="mode"
              :options="securityGroupOptions"
              :loading="loadingSecurityGroups"
              :placeholder="!vpcId? t('capa.clusterConfig.network.securityGroups.selectVpc') : ''"
              :multiple="true"
              @update:value="updateRule(index, 'sourceSecurityGroupIDs', $event)"
            />
          </div>
          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <LabeledSelect
              :disabled="!allowSecurityGroupRoles(rule)"
              :value="rule.sourceSecurityGroupRoles || []"
              :mode="mode"
              :options="SECURITY_GROUP_ROLE_OPTIONS"
              :multiple="true"
              @update:value="updateRule(index, 'sourceSecurityGroupRoles', $event)"
            />
          </div>
        </div>
      </div>

      <div>
        <div class="rule-row">
          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.cidrBlocks') }}</label>
          </div>
          <div
            v-if="allowTargets"
            class="longer-col"
          >
            <label class="text-label">{{ t('capa.clusterConfig.network.ingressRules.ipv6CidrBlocks') }}</label>
          </div>
        </div>
        <div
          v-if="allowTargets"
          class="rule-row"
        >
          <div class="longer-col">
            <LabeledInput
              :disabled="!allowCidr(rule)"
              :value="getLocalCidrValue(index, rule.cidrBlocks)"
              :mode="mode"
              :placeholder="t('capa.clusterConfig.network.ingressRules.cidrBlocksPlaceholder')"
              :rules="[validateCidrString]"
              @update:value="handleCidrInput(index, $event)"
              @blur="updateCidrFromLocalValue(index)"
            />
          </div>
          <div class="longer-col">
            <LabeledInput
              :disabled="!allowCidr(rule)"
              :value="getLocalIpv6CidrValue(index, rule.ipv6CidrBlocks)"
              :mode="mode"
              :rules="[validateIpv6CidrString]"
              :placeholder="t('capa.clusterConfig.network.ingressRules.ipv6CidrBlocksPlaceholder')"
              @update:value="handleIpv6CidrInput(index, $event)"
              @blur="updateIpv6CidrFromLocalValue(index)"
            />
          </div>
        </div>
      </div>

      <Checkbox
        v-if="allowTargets"
        :value="rule.natGatewaysIPsSource"
        :disabled="!allowNatGatewaysIPsSource(rule)"
        :mode="mode"
        :label="t('capa.clusterConfig.network.ingressRules.natGatewaysIPsSource')"
        @update:value="updateRule(index, 'natGatewaysIPsSource', $event)"
      />
    </RcSection>

    <div
      v-if="mode !== 'view'"
      class="row"
    >
      <div class="col span-12">
        <button
          :disabled="disableAdd"
          type="button"
          class="btn btn-sm role-secondary"
          @click="addRule"
        >
          {{ t('capa.clusterConfig.network.ingressRules.addRule') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ingress-rules {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.remove-button {
  display: flex;
  justify-content: end;
  margin-bottom: 16px;
}

.rule-row {
  display: flex;
  flex-direction: row;
  gap: var(--gap-md);
}

.short-col {
  width: 100px;
}

.longer-col {
  flex-grow: 1;
  flex-basis: 0%;
}
</style>
