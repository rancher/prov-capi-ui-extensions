<script setup lang="ts">
import { computed, toRefs, watch } from 'vue';
import Banner from '@components/Banner/Banner.vue';
import { _CREATE, _VIEW } from '@shell/config/query-params';
import { prepareProvCluster, provisioningClusterValidation } from '../utils';

defineOptions({ name: 'ProvisioningClusterConfiguration' });

const emit = defineEmits<{(e: 'update:value', value: any): void, (e: 'validationChanged', value: boolean): void }>();

interface Props {
  value: any;
  mode: string;
}

const props = withDefaults(defineProps<Props>(), {
  mode:  _CREATE,
  value: {}
});

const {
  mode,
  value,
} = toRefs(props);

watch(() => value.value?.spec?.kubernetesVersion, async() => {
  if (mode.value === _VIEW) {
    return;
  }
  await prepareProvCluster(value.value);
  emit('update:value', value.value);
}, { immediate: true });

const validationError = computed(() => {
  if (mode.value === _VIEW) {
    return null;
  }

  try {
    provisioningClusterValidation(value.value);

    return null;
  } catch (e: any) {
    return e?.message || null;
  }
});

watch(validationError, (neu) => {
  emit('validationChanged', !neu);
}, { immediate: true });

</script>

<template>
  <Banner
    v-if="validationError"
    color="error"
  >
    <t
      :k="validationError"
      :raw="true"
    />
  </Banner>
</template>

