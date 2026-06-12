<script setup lang="ts">
import {
  computed, onMounted, toRefs, ref, WritableComputedRef
} from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { RcSection } from '@components/RcSection';
import { _CREATE } from '@shell/config/query-params';
import merge from 'lodash/merge';
import { removeEmptyFields } from '../utils';
import { NORMAN } from '@shell/config/types';

defineOptions({ name: 'ClusterConfiguration' });

const emit = defineEmits<{(e: 'update:value', value: any): void }>();

const IDENTITY_ANNOTATION = 'identity-ref';

const defaultConfig = {
  spec: {
    region:  'us-west-2',
    network: {
      additionalControlPlaneIngressRules: [{ protocol: '-1', sourceSecurityGroupRoles: ['controlplane', 'node'] }], // allow all traffic from control plane security groups
      additionalNodeIngressRules:         [{ protocol: '-1', sourceSecurityGroupRoles: ['controlplane', 'node'] }],
      vpc:                                { id: 'vpc-07cdd250a077f6773' },
      subnets:                            [{ id: 'subnet-02e4caf6f4ee75111' }]
    },
    identityRef:              { name: 'cluster-identity', kind: 'AWSClusterStaticIdentity' },
    controlPlaneLoadBalancer: {
      healthCheckProtocol: 'TCP',
      loadBalancerType:    'nlb'
    }
  }
};

interface Props {
  value: any;
  mode: string;
  provider?: string;
  credentialId?: any;
  provisioningCluster?: any;
}

const props = withDefaults(defineProps<Props>(), {
  mode:         _CREATE,
  value:        () => ({ spec: {} }),
  provider:     '',
  credentialId: null,
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
const ec2Client = ref(null);
const regionInfo = ref(null);



const region: WritableComputedRef<string> = computed({
  get: () => value.value?.spec?.region || '',
  set: (newRegion: string) => {
    if (value.value) {
      value.value.spec = value.value.spec || {};
      value.value.spec.region = newRegion;
    }
    emit('update:value', value.value);
  },
});

const regionOptions = computed(() => {
  if ( !regionInfo.value ) {
    return [];
  }

  return regionInfo.value.map((obj) => {
    return obj.RegionName;
  }).sort();
});


function initDefaultRegion() {
  const region = value.value?.spec?.region || credentialId.value?.decodedData?.defaultRegion || store.getters['aws/defaultRegion'];

  if (!value.value?.spec?.region) {
    value.value.spec.region = region;
  }
}

async function getRegions() {
  if (!ec2Client.value || !region.value || !credentialId.value) {
    regionInfo.value = [];

    return;
  }

  const regions = await ec2Client.value.describeRegions({});

  regionInfo.value = regions?.Regions || [];
}

async function getIdentityRef() {
  if (!credentialId.value) {
    return null;
  }

  const credential = await store.dispatch('rancher/find', { type: NORMAN.CLOUD_CREDENTIAL, id: credentialId.value });

  if (!credential || !credential.annotations[IDENTITY_ANNOTATION]) {
    return null;
  }

  return credential.annotations[IDENTITY_ANNOTATION];
}

onMounted(async() => {
  initDefaultRegion();
  const identityRef = await getIdentityRef();

  ec2Client.value = await store.dispatch('aws/ec2', {
    region:            region.value,
    cloudCredentialId: credentialId.value
  });
  getRegions();
  const valueWithDefaults = merge({}, defaultConfig, value.value);

  if (identityRef) {
     valueWithDefaults.spec.identityRef.name = identityRef;
   }

  const cleanedValueWithDefaults = removeEmptyFields(valueWithDefaults);

  delete cleanedValueWithDefaults.spec.s3Bucket;

  emit('update:value', cleanedValueWithDefaults || {});
});

</script>

<template>
  <div class="mb-20">
    <RcSection
      :title="t('capa.clusterConfig.title')"
      :expandable="true"
      mode="with-header"
      type="primary"
    >
      <div class="mb-20 span-4">
        <LabeledSelect
          v-model:value="region"
          :mode="mode"
          :options="regionOptions"
          required
          :label="t('capa.clusterConfig.region.label')"
          :placeholder="t('capa.clusterConfig.region.placeholder')"
        />
      </div>
    </RcSection>
  </div>
</template>
