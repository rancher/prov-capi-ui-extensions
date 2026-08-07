import { ModelExtensionContext, IClusterModelExtension } from '@shell/core/types';
import { detailTabs, PROVIDER } from '../provisioner';

type ICluster = any;

export class CAPARKE2Cluster implements IClusterModelExtension {
  private context: ModelExtensionContext;

  constructor(context: ModelExtensionContext) {
    this.context = context;
  }

  useFor(cluster: ICluster) {
    return cluster.machineProvider === PROVIDER;
  }

  get detailTabs(): any {
    return detailTabs;
  }

  availableActions(cluster: any, actions: any[]): any[] | undefined {
    const hasCredentialReference = cluster && !!cluster.spec?.cloudCredentialSecretName;

    if (hasCredentialReference) {
      return actions;
    }

    return actions.filter((a) => a.action !== 'goToEdit' && a.action !== 'goToViewConfig');
  }
}
