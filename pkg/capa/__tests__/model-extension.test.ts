import { ModelExtensionContext } from '@shell/core/types';
import { CAPARKE2Cluster } from '../model-extension/provisioning.cattle.io.cluster';
import { PROVIDER, detailTabs } from '../provisioner';

const ACTIONS = [
  { action: 'goToEdit' },
  { action: 'goToViewConfig' },
  { action: 'goToViewYaml' },
  { action: 'promptRemove' },
];

describe('class: CAPARKE2Cluster', () => {
  const extension = new CAPARKE2Cluster({} as ModelExtensionContext);

  it.each([
    [PROVIDER, true],
    ['amazonec2', false],
    [undefined, false],
  ])('should be used for clusters with machine provider %p: %p', (machineProvider, expected) => {
    expect(extension.useFor({ machineProvider })).toBe(expected);
  });

  it('should share the provisioner detail tabs', () => {
    expect(extension.detailTabs).toBe(detailTabs);
  });

  it('should keep every action when the cluster references a cloud credential', () => {
    const cluster = { spec: { cloudCredentialSecretName: 'cattle-global-data:cc-1' } };

    expect(extension.availableActions(cluster, ACTIONS)).toBe(ACTIONS);
  });

  it.each([
    ['has no cloud credential', { spec: {} }],
    ['has an empty cloud credential', { spec: { cloudCredentialSecretName: '' } }],
    ['has no spec', {}],
    ['is missing', undefined],
  ])('should remove the edit and view config actions when the cluster %s', (_, cluster) => {
    expect(extension.availableActions(cluster, ACTIONS)).toStrictEqual([
      { action: 'goToViewYaml' },
      { action: 'promptRemove' },
    ]);
  });
});
