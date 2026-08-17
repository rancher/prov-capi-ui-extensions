<script setup lang="ts">
import {
  computed, onMounted, toRefs, ref, WritableComputedRef, watch
} from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import Banner from '@components/Banner/Banner.vue';
import { RcSection } from '@components/RcSection';
import { _CREATE, _VIEW } from '@shell/config/query-params';
import merge from 'lodash/merge';
import debounce from 'lodash/debounce';
import Networking from './Networking.vue';
import { DEFAULT_CLUSTER_CONFIG } from './constants';
import { NORMAN } from '@shell/config/types';
import { get, set, remove } from '@shell/utils/object.js';
import KeyValue from '@shell/components/form/KeyValue';
import * as AWS from '@shell/types/aws-sdk';
import { useFormValidation } from '@shell/composables/useFormValidation';
import * as validators from '../validators';
import { CAPA } from '../labels-annotations';
import type {
  IngressRule, CNIIngressRule, SubnetSpec, SecurityGroupRole, Tags, RancherAwsCloudCredential
} from '../types/capa';

defineOptions({ name: 'ClusterConfiguration' });

const emit = defineEmits<{(e: 'update:value', value: any): void, (e: 'validationChanged', value: boolean): void }>();

const defaultConfig = DEFAULT_CLUSTER_CONFIG;

interface Props {
  value: any;
  mode: string;
  credentialId?: any;
  provisioningCluster?: any;
}

const props = withDefaults(defineProps<Props>(), {
  mode:                _CREATE,
  value:               () => ({ spec: {} }),
  credentialId:        null,
  provisioningCluster: {}
});

const {
  mode,
  value,
  credentialId,
  provisioningCluster,
} = toRefs(props);

// Ensure spec is always present and reactive
if (value.value && !value.value.spec) {
  value.value.spec = {};
}

const store = useStore();
const { t } = useI18n(store);
const credentialErrors = ref<string[]>([]); // errors fetching data to populate the form (do not block form submission)
const credential = ref<RancherAwsCloudCredential>({}); // rancher cloud credential resource, needed to get an identity reference and default region
const useUnmanagedNetwork = ref(false); // used by a radio in networking and doesn't correspond to anything in cluster config - tracking it here to use w/ validators
const ec2Client = ref(null);
const regionInfo = ref<AWS.EC2Region[]>([]);
const sshKeyInfo = ref([]);
const loadingRegions = ref(false);
const loadingSshKeys = ref(false);
const vpcInfo = ref<AWS.VPC[]>([]);
const subnetInfo = ref<AWS.Subnet[]>([]);
const securityGroupInfo = ref<AWS.SecurityGroup[]>([]);
const loadingVpcs = ref(false);
const loadingSubnets = ref(false);
const loadingSecurityGroups = ref(false);
const showIdentityError = ref(false);
let identityRetryTimer: ReturnType<typeof setInterval> | null = null;

const { getRules, isFormValid } = useFormValidation(
  t,
  [
    { path: 'region', rules: ['region'] },
    { path: 'vpc', rules: ['vpc'] },
    { path: 'subnet', rules: ['subnet'] },
    { path: 'cidrBlock', rules: ['cidrBlock'] },
    { path: 'additionalControlPlaneIngressRules', rules: ['additionalControlPlaneIngressRules'] },
    { path: 'additionalNodeIngressRules', rules: ['additionalNodeIngressRules'] },
  ],
  {
    region:                             (val: unknown) => validators.region(t, val as string),
    vpc:                                (val: unknown) => validators.vpc(t, val as string, useUnmanagedNetwork.value),
    subnet:                             (val: unknown) => validators.subnet(t, val as string[], useUnmanagedNetwork.value),
    cidrBlock:                          (val: unknown) => validators.cidrBlock(t, val as string, useUnmanagedNetwork.value),
    additionalControlPlaneIngressRules: () => validators.validateIngressRulesCidr(t, additionalControlPlaneIngressRules.value),
    additionalNodeIngressRules:         () => validators.validateIngressRulesCidr(t, additionalNodeIngressRules.value),
  }
);

// Helper to create computed properties backed by a nested path on value.value
// `set` from @shell/utils/object creates intermediate objects along the path
function specComputed<T>(path: string, defaultValue: T): WritableComputedRef<T> {
  return computed({
    get: () => get(value.value, path) ?? defaultValue,
    set: (neu: T) => {
      if (neu === null || neu === undefined) {
        remove(value.value, path);
      } else {
        set(value.value, path, neu);
      }
      emit('update:value', value.value);
    },
  });
}

const region = specComputed<string>('spec.region', '');
const sshKeyName = specComputed<string>('spec.sshKeyName', '');
const vpcId = specComputed<string>('spec.network.vpc.id', '');
const cidrBlock = specComputed<string>('spec.network.vpc.cidrBlock', '');
const securityGroupOverrides = specComputed<Partial<Record<SecurityGroupRole, string>>>('spec.network.securityGroupOverrides', {});
const subnets = specComputed<SubnetSpec[]>('spec.network.subnets', []);
const additionalControlPlaneIngressRules = specComputed<IngressRule[]>('spec.network.additionalControlPlaneIngressRules', []);
const additionalNodeIngressRules = specComputed<IngressRule[]>('spec.network.additionalNodeIngressRules', []);
const additionalTags = specComputed<Tags>('spec.additionalTags', {});
const cniIngressRules = specComputed<CNIIngressRule[]>('spec.network.cni.cniIngressRules', []);

// ipv6 is "enabled" by setting an empty object and "disabled" by deleting the ipv6 field
const ipv6: WritableComputedRef<object | null> = computed({
  get: () => value?.value?.spec?.network?.ipv6 || null,
  set: (neu: object | undefined) => {
    if (neu) {
      set(value.value, 'spec.network.ipv6', neu);
    } else if (value.value?.spec?.network) {
      delete value.value.spec.network.ipv6;
    }
    emit('update:value', value.value);
  },
});

const hasIdentityRef = computed(() => {
  const ref = value.value?.spec?.identityRef;

  return !!(ref?.name && ref?.kind);
});

const isCreate = computed(() => {
  return mode.value === _CREATE;
});

const regionOptions = computed(() => {
  if ( !regionInfo.value ) {
    return [];
  }

  return regionInfo.value.map((obj) => {
    return obj.RegionName;
  }).sort();
});

const sshKeyOptions = computed(() => {
  const noneOption = { label: t('capa.clusterConfig.sshKeyName.noneLabel'), value: '' };

  if (!sshKeyInfo.value) {
    return [noneOption];
  }

  return [noneOption, ...sshKeyInfo.value.map((k: {KeyName: string}) => {
    return { label: k.KeyName, value: k.KeyName };
  })];
});

function initDefaultRegion() {
  const region = value.value?.spec?.region || credential?.value?.amazonec2credentialConfig?.defaultRegion || store.getters['aws/defaultRegion'];

  if (!value.value?.spec?.region) {
    set(value.value, 'spec.region', region);
  }
}

async function getCloudCredential() {
  if (!credentialId.value || !isCreate.value) {
    return;
  }
  remove(value.value, 'spec.identityRef');
  showIdentityError.value = false;

  // Cancel any existing retry loop
  if (identityRetryTimer) {
    clearInterval(identityRetryTimer);
    identityRetryTimer = null;
  }

  try {
    credential.value = await store.dispatch('rancher/find', {
      type: NORMAN.CLOUD_CREDENTIAL, id: credentialId.value, opt: { force: true }
    });
    initDefaultRegion();

    if (credential.value?.annotations?.[CAPA.IDENTITY_REF]) {
      setIdentityRef();
    } else {
      // Retry every 500ms for up to 5 seconds waiting for the annotation to appear
      const maxAttempts = 10;
      let attempts = 0;
      const savedCredentialId = credentialId.value;

      identityRetryTimer = setInterval(async() => {
        attempts++;

        // Stop if credential changed while retrying
        if (credentialId.value !== savedCredentialId) {
          if (identityRetryTimer) {
            clearInterval(identityRetryTimer);
            identityRetryTimer = null;
          }

          return;
        }

        try {
          credential.value = await store.dispatch('rancher/find', {
            type: NORMAN.CLOUD_CREDENTIAL, id: savedCredentialId, opt: { force: true }
          });

          if (credential.value?.annotations?.[CAPA.IDENTITY_REF]) {
            setIdentityRef();
            if (identityRetryTimer) {
              clearInterval(identityRetryTimer);
              identityRetryTimer = null;
            }
          } else if (attempts >= maxAttempts) {
            showIdentityError.value = true;
            if (identityRetryTimer) {
              clearInterval(identityRetryTimer);
              identityRetryTimer = null;
            }
          }
        } catch {
          if (attempts >= maxAttempts) {
            showIdentityError.value = true;
            if (identityRetryTimer) {
              clearInterval(identityRetryTimer);
              identityRetryTimer = null;
            }
          }
        }
      }, 500);
    }
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingCloudCredential', { error: e }));
  }
}

function setIdentityRef() {
  if (!credential.value) {
    return;
  }
  const name = credential.value?.annotations?.[CAPA.IDENTITY_REF];

  if (!name) {
    // this shouldnt be hit because Turtles sets the annotation on all aws credentials, buuut just in case
    // the template shows an error banner via v-if="!hasIdentityRef" if identityRef remains unset
    return;
  }

  set(value.value, 'spec.identityRef', { name, kind: 'AWSClusterStaticIdentity' });
}

async function getRegions() {
  loadingRegions.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    regionInfo.value = [];
    loadingRegions.value = false;

    return;
  }

  try {
    const regions = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeRegions' });

    regionInfo.value = regions || [];
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingRegions', { error: e }));
  } finally {
    loadingRegions.value = false;
  }
}

async function getSshKeys() {
  loadingSshKeys.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    sshKeyInfo.value = [];
    loadingSshKeys.value = false;

    return;
  }

  try {
    const keys = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeKeyPairs' });

    sshKeyInfo.value = keys || [];
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingSshKeys', { error: e }));
  } finally {
    loadingSshKeys.value = false;
  }
}

async function getVpcs() {
  loadingVpcs.value = true;

  if (!ec2Client.value || !region.value || !credentialId.value) {
    vpcInfo.value = [];
    loadingVpcs.value = false;

    return;
  }

  try {
    const vpcs = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeVpcs' });

    vpcInfo.value = vpcs || [];
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingVpcs', { error: e }));
  } finally {
    loadingVpcs.value = false;
  }
}

async function getSubnets() {
  loadingSubnets.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    subnetInfo.value = [];
    loadingSubnets.value = false;

    return;
  }

  try {
    const fetchedSubnets = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeSubnets' });

    subnetInfo.value = fetchedSubnets || [];
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingSubnets', { error: e }));
  } finally {
    loadingSubnets.value = false;
  }
}

async function getSecurityGroups() {
  loadingSecurityGroups.value = true;
  if (!ec2Client.value || !region.value || !credentialId.value) {
    securityGroupInfo.value = [];
    loadingSecurityGroups.value = false;

    return;
  }

  try {
    const securityGroups = await store.dispatch('aws/depaginateList', { client: ec2Client.value, cmd: 'describeSecurityGroups' });

    securityGroupInfo.value = securityGroups || [];
  } catch (e) {
    credentialErrors.value.push(t('capa.errors.fetchingSecurityGroups', { error: e }));
  } finally {
    loadingSecurityGroups.value = false;
  }
}

const debouncedFetchAll = debounce((fetchRegions: boolean) => {
  if (fetchRegions) {
    getRegions();
  }
  getSshKeys();
  getVpcs();
  getSubnets();
  getSecurityGroups();
}, 1);

onMounted(async() => {
  if (mode.value === _CREATE) {
    const valueWithDefaults = merge({}, defaultConfig, value.value);

    emit('update:value', valueWithDefaults || {});
  }
});

// Workaround for https://github.com/rancher/dashboard/issues/18850 
const requiredFieldValues = computed(() => ({
  region:                             region.value,
  vpc:                                vpcId.value,
  subnet:                             subnets.value,
  cidrBlock:                          cidrBlock.value,
  additionalControlPlaneIngressRules: additionalControlPlaneIngressRules.value,
  additionalNodeIngressRules:         additionalNodeIngressRules.value,
}));

const isDataValid = computed(() => {
  return Object.entries(requiredFieldValues.value).every(([path, val]) => {
    return getRules(path).every((rule) => !rule(val));
  });
});

const formValid = computed(() => isFormValid.value && isDataValid.value);

watch([formValid, hasIdentityRef], ([valid = true, hasIdentityRef]) => {
  emit('validationChanged', valid && hasIdentityRef);
}, { immediate: true });

watch(credential, () => {
  setIdentityRef();
}, { deep: true });

watch(useUnmanagedNetwork, (neu, old) => {
  if (old && !neu) {
    securityGroupOverrides.value = {};
  }
});

watch([
  () => region.value,
  () => credentialId.value,
], async([newRegion, newCredentialId], [oldRegion, oldCredentialId]) => {
  if (mode.value === _VIEW) {
    return;
  }
  credentialErrors.value = [];
  if (newCredentialId && newCredentialId !== oldCredentialId) {
    // need to await cloud cred as subsequent functions depend on it
    // the other get* functions are not awaited and loading props are used to display spinners in relevant inputs
    await getCloudCredential();
  }

  if (region.value && credentialId.value) {
    ec2Client.value = await store.dispatch('aws/ec2', {
      region:            region.value,
      cloudCredentialId: credentialId.value
    });

    if (oldRegion && newRegion !== oldRegion && mode.value === _CREATE) {
      vpcId.value = ''; // this will trigger removal of any vpc-dependent configuration
      sshKeyName.value = '';
    }

    debouncedFetchAll(!oldRegion);
  } else {
    vpcInfo.value = [];
    sshKeyInfo.value = [];
    subnetInfo.value = [];
    regionInfo.value = [];
    securityGroupInfo.value = [];
  }
}, { immediate: true });

</script>

<template>
  <div class="infrastructure-cluster-configuration mmb-6">
    <Banner
      v-for="e in credentialErrors"
      :key="e"
      :label="e"
      color="error"
      class="m-0"
    />
    <Banner
      v-if="credentialId && showIdentityError"
      color="error"
      :label="t('capa.errors.missingIdentityRef', { annotation: CAPA.IDENTITY_REF }, true)"
      class="m-0"
    />
    <RcSection
      :title="t('capa.clusterConfig.title')"
      :expandable="true"
      mode="with-header"
      type="primary"
    >
      <RcSection
        :title="t('capa.clusterConfig.generalConfiguration.title')"
        :expandable="true"
        mode="with-header"
        type="secondary"
      >
        <div class="row">
          <div class="span-4">
            <LabeledSelect
              v-model:value="region"
              :loading="loadingRegions"
              :mode="mode"
              :options="regionOptions"
              required
              :label="t('capa.clusterConfig.region.label')"
              :placeholder="t('capa.clusterConfig.region.placeholder')"
              name="region"
              :rules="getRules('region')"
              :disabled="!isCreate"
            />
          </div>
        </div>
        <div class="row mmb-6">
          <div class="span-4">
            <LabeledSelect
              v-model:value="sshKeyName"
              :loading="loadingSshKeys"
              :mode="mode"
              :options="sshKeyOptions"
              :label="t('capa.clusterConfig.sshKeyName.label')"
              :sub-label="t('capa.clusterConfig.sshKeyName.description')"
            />
          </div>
        </div>
        <RcSection
          :title="t('capa.machineConfig.advanced.tags.title')"
          :expandable="true"
          mode="with-header"
          type="secondary"
          :expanded="false"
        >
          <h5>{{ t('capa.machineConfig.advanced.tags.description') }}</h5>
          <KeyValue
            v-model:value="additionalTags"
            :mode="mode"
            :read-allowed="false"
            :as-map="true"
            :add-label="t('capa.machineConfig.advanced.tags.add')"
            data-testid="capa-resource-tags-input"
          />
        </RcSection>
      </RcSection>

      <RcSection
        :title="t('capa.clusterConfig.network.title')"
        :expandable="true"
        mode="with-header"
        type="secondary"
      >
        <Networking
          v-model:vpc-id="vpcId"
          v-model:subnets="subnets"
          v-model:ipv6="ipv6"
          v-model:security-group-overrides="securityGroupOverrides"
          v-model:additional-control-plane-ingress-rules="additionalControlPlaneIngressRules"
          v-model:additional-node-ingress-rules="additionalNodeIngressRules"
          v-model:cni-ingress-rules="cniIngressRules"
          v-model:use-unmanaged-network="useUnmanagedNetwork"
          v-model:cidr-block="cidrBlock"
          :provisioning-cluster="provisioningCluster"
          :mode="mode"
          :vpc-info="vpcInfo"
          :subnet-info="subnetInfo"
          :security-group-info="securityGroupInfo"
          :loading-vpcs="loadingVpcs"
          :loading-subnets="loadingSubnets"
          :loading-security-groups="loadingSecurityGroups"
          :vpc-validators="getRules('vpc')"
          :subnet-validators="getRules('subnet')"
          :cidr-block-validators="getRules('cidrBlock')"
          :additional-control-plane-ingress-rules-validators="getRules('additionalControlPlaneIngressRules')"
          :additional-node-ingress-rules-validators="getRules('additionalNodeIngressRules')"
        />
      </RcSection>
    </RcSection>
  </div>
</template>

<style scoped lang="scss">
.infrastructure-cluster-configuration {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}
</style>

