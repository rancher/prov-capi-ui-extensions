import { reactive, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import Banner from '@components/Banner/Banner.vue';
import { _CREATE, _EDIT, _VIEW } from '@shell/config/query-params';
import ProvisioningClusterConfiguration from '../ProvisioningClusterConfiguration.vue';

const machineSelectorKeys = (cluster: any) => cluster.spec.rkeConfig.machineSelectorConfig.map((c: any) => c.machineLabelSelector.matchExpressions[0].key);

describe('component: ProvisioningClusterConfiguration', () => {
  it.each([_CREATE, _EDIT])('should add the cloud provider configuration to the cluster in %p mode', async(mode) => {
    const cluster: any = reactive({ spec: { kubernetesVersion: 'v1.32.1+rke2r1' } });
    const wrapper = mount(ProvisioningClusterConfiguration, { props: { value: cluster, mode } });

    await flushPromises();

    expect(cluster.spec.rkeConfig.additionalManifest).toContain('aws-cloud-controller-manager');
    expect(cluster.agentConfig['cloud-provider-name']).toBe('external');
    expect(wrapper.emitted('update:value')?.[0]).toStrictEqual([cluster]);
    expect(wrapper.emitted('validationChanged')?.[0]).toStrictEqual([true]);
    expect(wrapper.findComponent(Banner).exists()).toBe(false);
  });

  it('should leave the cluster untouched in view mode', async() => {
    const cluster: any = reactive({ spec: { kubernetesVersion: 'v1.32.1+rke2r1' } });
    const wrapper = mount(ProvisioningClusterConfiguration, { props: { value: cluster, mode: _VIEW } });

    await flushPromises();

    expect(cluster).toStrictEqual({ spec: { kubernetesVersion: 'v1.32.1+rke2r1' } });
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('validationChanged')?.[0]).toStrictEqual([true]);
    expect(wrapper.findComponent(Banner).exists()).toBe(false);
  });

  it('should add the k3s selector config when the kubernetes version changes to k3s', async() => {
    const cluster: any = reactive({ spec: { kubernetesVersion: 'v1.32.1+rke2r1' } });
    const wrapper = mount(ProvisioningClusterConfiguration, { props: { value: cluster, mode: _CREATE } });

    expect(machineSelectorKeys(cluster)).toHaveLength(2);

    cluster.spec.kubernetesVersion = 'v1.32.1+k3s1';
    await flushPromises();

    // the rke2 entries are kept and the k3s entries appended
    expect(machineSelectorKeys(cluster)).toStrictEqual([
      'rke.cattle.io/control-plane-role',
      'rke.cattle.io/etcd-role',
      'rke.cattle.io/control-plane-role',
      'rke.cattle.io/etcd-role',
      'rke.cattle.io/worker-role',
    ]);
    expect(wrapper.emitted('update:value')).toHaveLength(2);
    expect(wrapper.findComponent(Banner).exists()).toBe(false);
  });

  it('should show the validation error and report the form as invalid when the user removes required config', async() => {
    const cluster: any = reactive({ spec: { kubernetesVersion: 'v1.32.1+rke2r1' } });
    const wrapper = mount(ProvisioningClusterConfiguration, { props: { value: cluster, mode: _EDIT } });

    cluster.agentConfig['cloud-provider-name'] = 'aws';
    await nextTick();

    const banner = wrapper.findComponent(Banner);

    expect(banner.exists()).toBe(true);
    expect(banner.props('color')).toBe('error');
    expect(wrapper.emitted('validationChanged')).toStrictEqual([[true], [false]]);

    cluster.agentConfig['cloud-provider-name'] = 'external';
    await nextTick();

    expect(wrapper.findComponent(Banner).exists()).toBe(false);
    expect(wrapper.emitted('validationChanged')).toStrictEqual([[true], [false], [true]]);
  });
});
