import { importTypes } from '@rancher/auto-import';
import {
  IExtension,
  ModelExtensionConstructor,
  RelatedResourcesLocation,
  RelatedResource,
  RelatedResourceContext,
  RelatedResourceSave,
  RelatedResourceSaveHook
} from '@shell/core/types';
import { machinePoolStoreFor, saveMachineConfigYaml } from '@shell/utils/machine-pools';
import { keyForResource } from '@shell/utils/related-resources/resource-key';
import { CAPAProvisioner, hasCAPAInfrastructure } from './provisioner';
import { hasUnsavedMachinePool, saveMachinePoolConfigYaml } from './utils';
import { CAPARKE2Cluster } from './model-extension/provisioning.cattle.io.cluster';
import { CAPI } from '@shell/config/types';
import { AWS_CLUSTER_SCHEMA, AWS_IDENTITY_GROUP, AWS_MACHINE_TEMPLATE_SCHEMA } from './types/capa';

export const MACHINE_TEMPLATE_GROUP = 'capa.resourceGraph.groups.machineTemplates';
export const INFRASTRUCTURE_CLUSTER_GROUP = 'capa.resourceGraph.groups.infrastructureCluster';
export const IDENTITY_REFERENCE_GROUP = 'capa.resourceGraph.groups.identityReference';

/**
 * Fetch a resource from the management store, logging and swallowing any failure so that one
 * missing resource doesn't stop the rest of the graph from being built
 */
async function findOrNull(cluster: any, type: string, id: string): Promise<any | null> {
  return await cluster.$dispatch('management/find', { type, id }, { root: true })
    .catch((e: any) => {
      console.warn(`CAPA: couldn't load ${ type } ${ id }`, e); // eslint-disable-line no-console

      return null;
    });
}

/**
 * Asks the user to confirm that saving a machine template replaces it and saves the cluster
 *
 * `closeOnClickOutside` is off: GenericPrompt calls `confirm` only from its own buttons, so closing
 * the modal any other way would leave the save waiting
 *
 * @returns false when the user cancels
 */
function confirmMachineTemplateReplace(ctx: RelatedResourceContext, context: ReturnType<typeof machinePoolStoreFor>, t: (key: string) => string): Promise<boolean> {
  const clusterYaml = ctx.editorState.yaml[ctx.primaryNodeId];
  const clusterModified = clusterYaml !== undefined && clusterYaml !== ctx.initialYaml[ctx.primaryNodeId];

  return new Promise((resolve) => {
    context.dispatch('management/promptModal', {
      component:           'GenericPrompt',
      closeOnClickOutside: false,
      componentProps:      {
        title:     t('capa.resourceGraph.replaceMachineTemplate.title'),
        body:      t(clusterModified ? 'capa.resourceGraph.replaceMachineTemplate.bodyClusterModified' : 'capa.resourceGraph.replaceMachineTemplate.body'),
        applyMode: 'continue',
        confirm:   (confirmed: boolean) => resolve(!!confirmed),
      },
    });
  });
}

/**
 * The save hooks and `save` of the AWS machine templates edited as YAML
 *
 * As in the cluster form, the template is replaced rather than updated, and the pool in the
 * cluster's YAML is pointed at the replacement. The user confirms this first, and the cluster is
 * saved straight after, so it references the replacement
 *
 * As in `cleanupMachinePoolConfigs`, a replaced template is removed once the saved cluster no longer
 * references it. While the cluster save fails, the saved cluster still references it, so it is kept
 */
function machineTemplateHooks(cluster: any): Pick<RelatedResource, 'beforeSaveHook' | 'save' | 'afterSaveHook'> {
  const store = machinePoolStoreFor(cluster);
  const t = cluster.$rootGetters['i18n/t'];
  const context = { ...store, t };
  let replaced: any[] = [];

  // show a confirmation modal
  const beforeSaveHook: RelatedResourceSaveHook = (ctx) => confirmMachineTemplateReplace(ctx, store, t);

  const save: RelatedResourceSave = async(ctx) => {
    const saved = await saveMachineConfigYaml(ctx, context, async(entry, clusterName) => {
      await saveMachinePoolConfigYaml(entry, clusterName, context);
    });

    if (keyForResource(saved) !== keyForResource(ctx.resource)) {
      replaced.push(ctx.resource);
    }

    return saved;
  };

  // `ctx.resource` is the saved template
  const afterSaveHook: RelatedResourceSaveHook = async(ctx) => {
    // false when the template was not modified, so no replacement was created
    if (!hasUnsavedMachinePool(ctx)) {
      return;
    }

    const savedCluster = await ctx.saveResource(ctx.primaryNodeId);
    const referenced = new Set((savedCluster?.spec?.rkeConfig?.machinePools || []).map((pool: any) => pool.machineConfigRef?.name));
    const unreferenced = replaced.filter((template) => !referenced.has(template.metadata?.name));

    replaced = replaced.filter((template) => referenced.has(template.metadata?.name));

    for (const template of unreferenced) {
      await template.remove().catch((e: any) => {
        console.warn('capa: failed to remove replaced machine template', e); // eslint-disable-line no-console
      });
    }
  };

  return {
    beforeSaveHook, save, afterSaveHook
  };
}

/**
 * The AWS machine templates referenced by the cluster's machine pools
 *
 * These are the same resources the provisioning cluster model contributes, so they are re-grouped
 * under a CAPA specific heading rather than added a second time
 */
async function fetchMachineTemplates(cluster: any): Promise<RelatedResource[]> {
  const names: string[] = (cluster.spec?.rkeConfig?.machinePools || [])
    .map((pool: any) => pool.machineConfigRef?.name)
    .filter((name?: string) => !!name);

  const templates = await Promise.all(names.map((name) => findOrNull(
    cluster,
    AWS_MACHINE_TEMPLATE_SCHEMA,
    `${ cluster.metadata?.namespace }/${ name }`
  )));

  const hooks = machineTemplateHooks(cluster);

  return templates
    .filter((template) => !!template)
    .map((resource) => ({
      resource,
      groupKey: MACHINE_TEMPLATE_GROUP,
      ...hooks,
      // the replacement template is referenced only by the unsaved cluster yaml when the cluster save failed
      banner:   (ctx) => (hasUnsavedMachinePool(ctx) ? { color: 'error', labelKey: 'capa.resourceGraph.banners.unsavedMachineTemplate' } : null),
    }));
}

/**
 * The AWSCluster the provisioning cluster's `infrastructureRef` points at
 *
 * The identity it references is contributed by the AWSCluster registration below, which the shell
 * applies when it expands the tree from here
 */
async function fetchInfrastructureCluster(cluster: any): Promise<RelatedResource[]> {
  const ref = cluster.spec?.rkeConfig?.infrastructureRef;

  if (!ref?.name) {
    return [];
  }

  const namespace = ref.namespace || cluster.metadata?.namespace;
  const infrastructureCluster = await findOrNull(cluster, AWS_CLUSTER_SCHEMA, `${ namespace }/${ ref.name }`);

  return infrastructureCluster ? [{
    resource: infrastructureCluster,
    groupKey: INFRASTRUCTURE_CLUSTER_GROUP,
  }] : [];
}

/**
 * The identity an AWSCluster's `identityRef` points at, which holds the credentials CAPA uses to
 * talk to AWS. The identity types are all cluster scoped, so the reference is a bare name
 */
async function fetchIdentityReference(awsCluster: any): Promise<RelatedResource[]> {
  const ref = awsCluster.spec?.identityRef;

  if (!ref?.kind || !ref?.name) {
    return [];
  }

  const identity = await findOrNull(awsCluster, `${ AWS_IDENTITY_GROUP }.${ ref.kind.toLowerCase() }`, ref.name);

  return identity ? [{
    resource: identity,
    groupKey: IDENTITY_REFERENCE_GROUP,
  }] : [];
}

/**
 * `ours` added to `relatedResources`, replacing any entry for the same resource
 */
function mergeRelatedResources(relatedResources: RelatedResource[], ours: RelatedResource[]): RelatedResource[] {
  const ourKeys = new Set(ours.map((entry) => keyForResource(entry.resource)).filter(Boolean));

  return [...relatedResources.filter((entry) => !ourKeys.has(keyForResource(entry.resource))), ...ours];
}

// Init the package
export default function(plugin: IExtension): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Register custom provisioner object
  plugin.register('provisioner', CAPAProvisioner.ID, CAPAProvisioner);

  // Built-in icon
  plugin.metadata.icon = require('./assets/amazoncapa.svg');
  // Register machine config component
  plugin.register('machine-config', CAPAProvisioner.ID, () => import('./machine-config/capa.vue'));

  // Register a model extension for the provisioning model
  plugin.addModelExtension('provisioning.cattle.io.cluster', CAPARKE2Cluster as ModelExtensionConstructor);

  // Show the AWS resources behind a CAPA cluster alongside the cluster itself, so they can all be
  // edited as YAML on the one page: the machine templates its machine pools reference and the
  // AWSCluster its infrastructureRef points at
  plugin.addRelatedResources(
    RelatedResourcesLocation.RESOURCE_YAML,
    { resource: [CAPI.RANCHER_CLUSTER] },
    {
      fetchExtensionRelatedResources: async(cluster: any, relatedResources: RelatedResource[]) => {
        // This extension point is registered for every provisioning cluster, so only contribute
        // to the ones this extension actually provisions
        if (!hasCAPAInfrastructure(cluster)) {
          return relatedResources;
        }

        const [machineTemplates, infrastructureCluster] = await Promise.all([
          fetchMachineTemplates(cluster),
          fetchInfrastructureCluster(cluster),
        ]);

        // the cluster model adds the machine templates under its own generic group, so ours, with
        // the CAPA groups, replace them
        return mergeRelatedResources(relatedResources, [...machineTemplates, ...infrastructureCluster]);
      }
    }
  );

  // The identity behind an AWSCluster. The shell matches this against every AWSCluster in the tree,
  // not only one in the route, so it also applies below a provisioning cluster
  plugin.addRelatedResources(
    RelatedResourcesLocation.RESOURCE_YAML,
    { resource: [AWS_CLUSTER_SCHEMA] },
    {
      fetchExtensionRelatedResources: async(awsCluster: any, relatedResources: RelatedResource[]) => {
        return mergeRelatedResources(relatedResources, await fetchIdentityReference(awsCluster));
      }
    }
  );
}
