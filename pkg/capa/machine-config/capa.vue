<script lang="ts">
import Loading from '@shell/components/Loading';
import { Banner } from '@components/Banner';
import CreateEditView from '@shell/mixins/create-edit-view';
import { HTTP_TOKENS_VALUES } from './constants';
import { NORMAN } from '@shell/config/types';
import { exceptionToErrorsArray, formatAWSError, stringify } from '@shell/utils/error';
import { _CREATE } from '@shell/config/query-params';
import merge from 'lodash/merge';
import { removeEmptyFields } from '../utils';

const defaultConfig = {
  spec: {
    template: {
      spec: {
        ami:                     { id: 'ami-0d13e2317a7e75c95' },
        cloudInit:               { insecureSkipSecretsManager: true },
        iamInstanceProfile:      'control-plane.cluster-api-provider-aws.sigs.k8s.io',
        instanceMetadataOptions: { httpTokens: HTTP_TOKENS_VALUES.REQUIRED },
        instanceType:            't3.medium',
        marketType:              'OnDemand',
        publicIp:                false,
        rootVolume:              {
          encrypted: false, size: 30, type: 'gp3'
        },
        sshKeyName:     'eva',
        subnet:         { id: 'subnet-02e4caf6f4ee75111' },
        privateDnsName: { hostnameType: 'resource-name' }
      }
    }
  }
};

export default {
  components: { Banner, Loading },

  mixins: [CreateEditView],

  emits: ['validationChanged', 'update:value'],

  props: {
    uuid: {
      type:     String,
      required: true,
    },

    infrastructureCluster: {
      type:    Object,
      default: () => ({})
    },

    credentialId: {
      type:     String,
      required: true,
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    isIpv6: {
      type:    Boolean,
      default: false
    },

    isDualStack: {
      type:    Boolean,
      default: false
    },

    machinePools: {
      type:    Array,
      default: () => []
    },

    poolCreateMode: {
      type:    Boolean,
      default: true
    },
    mode: {
      type:    String,
      default: _CREATE,
    },
  },

  async fetch() {
    const self = this as any;

    self.errors = [];
    if ( !self.credentialId ) {
      return;
    }

    try {
      if ( self.credential?.id !== self.credentialId ) {
        self.credential = await self.$store.dispatch('rancher/find', { type: NORMAN.CLOUD_CREDENTIAL, id: self.credentialId });
      }
    } catch (e) {
      self.credential = null;
    }

    try {
      const valueWithDefaults = merge({}, defaultConfig, self.value);

      // TODO this is a band-aid to make sure defaults are applied before validation, but should be refactored to be cleaner and not cause an extra render
      // this.$emit('update:value', valueWithDefaults);
      const cleanedValueWithDefaults = removeEmptyFields(valueWithDefaults);

      Object.assign(self.value, cleanedValueWithDefaults || {});
    } catch (e) {
      self.errors = exceptionToErrorsArray(formatAWSError(e));
    }
  }
};
</script>

<template>
  <div>
    <Loading v-if="$fetchState.pending" />
    <template v-else>
      <div v-if="errors.length">
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
    </template>
  </div>
</template>
