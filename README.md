# SUSE CAPI UI Extensions

Rancher Dashboard extensions that add [Cluster API (CAPI)](https://cluster-api.sigs.k8s.io/) provisioning support to Rancher's cluster management UI, via [Rancher Turtles](https://github.com/rancher/turtles). Today the repo ships one extension, **CAPA** (`pkg/capa`), which adds a "CAPI AWS" cluster provisioner backed by [Cluster API Provider AWS](https://cluster-api-aws.sigs.k8s.io/).

## Repository layout

```
pkg/capa/                                  the CAPA (AWS) provisioner extension package
  index.ts                                 extension entry point: registers the provisioner, machine-config component, model extension
  provisioner.ts                           IClusterProvisioner implementation (CAPAProvisioner)
  model-extension/
    provisioning.cattle.io.cluster.ts      IClusterModelExtension implementation (CAPARKE2Cluster)
  components/                              infrastructure cluster (AWSCluster) form: general/network/security config
  machine-config/                          per-machine-pool form (AWSMachineTemplate): instance/storage/advanced config
  types/capa.ts                            TypeScript types mirroring the CAPA CRDs the UI reads/writes
  validators.ts                            field-level form validation (CIDRs, required fields, etc.)
  utils.ts                                 save/init logic for the infrastructure cluster and machine pool configs
  labels-annotations.js                    well-known label/annotation keys (e.g. the Turtles identity-ref annotation)
  l10n/en-us.yaml                          UI strings
  package.json                             extension metadata (catalog annotations, display name, icon)
```

Extensions are built and packaged with the standard [Rancher Extensions](https://github.com/rancher/dashboard) tooling (`@rancher/shell`), driven from the scripts in the root `package.json`.

---

## Using the extension: provisioning AWS clusters

See [`pkg/capa/USAGE.md`](pkg/capa/USAGE.md) for the AWS/CAPA-specific walkthrough: prerequisites, creating and editing a cluster, and troubleshooting.

---

## Building a similar extension for another provider

`pkg/capa` is a working reference implementation of Rancher's CAPI provisioner extension point. To support a different infrastructure provider (e.g. Azure/CAPZ, GCP/CAPG, vSphere/CAPV), you plug into the same extension points, backed by that provider's own Cluster API CRDs.

For the concepts (CAPI's infrastructure/control-plane/bootstrap role split, the infrastructure cluster and machine pool config resources) and the `IClusterProvisioner`/model-extension/cloud-credential registration points themselves, see the Rancher UI Extensions docs:

- [Cluster Provisioning](https://extensions.rancher.io/extensions/next/provisioning/overview)
- [CAPI-backed Provisioners](https://extensions.rancher.io/extensions/next/provisioning/capi-provisioner)
- [Cloud Credentials](https://extensions.rancher.io/extensions/next/provisioning/cloud-credential)

Everything for this extension is wired up in `pkg/capa/index.ts`, which is the pattern to copy:

```ts
export default function(plugin: IExtension): void {
  importTypes(plugin);        // auto-import model/detail/edit from folders
  plugin.metadata = require('./package.json');
  plugin.register('provisioner', CAPAProvisioner.ID, CAPAProvisioner);
  plugin.register('machine-config', CAPAProvisioner.ID, () => import('./machine-config/capa.vue'));
  plugin.addModelExtension('provisioning.cattle.io.cluster', CAPARKE2Cluster as ModelExtensionConstructor);
}
```

- **`provisioner`** — `pkg/capa/provisioner.ts` (`CAPAProvisioner`) implements `IClusterProvisioner`, including the CAPI-specific members (`isUpstreamCAPIProvider`, `extensionInfrastructureSection`, `saveMachinePoolConfigs`, `registerInitHooks`/`registerSaveHooks`, etc.) documented in the linked docs above. CAPA hides itself from the cluster-type picker until the `aws` `capi.cattle.io.capiprovider` resource exists (i.e. until Turtles has deployed that infra provider) — see the `hidden` getter.
- **`machine-config`** — `pkg/capa/machine-config/capa.vue` plus its child sections (`InstanceConfigSection.vue`, `StorageSection.vue`, `AdvancedSection.vue`).
- **Model extension** — `pkg/capa/model-extension/provisioning.cattle.io.cluster.ts` (`CAPARKE2Cluster`) implements `IClusterModelExtension`; CAPA uses it to control `detailTabs` and to hide edit/view-config actions when the cluster has no cloud credential reference yet.
- **Cloud credential** — the corresponding component would live under a `cloud-credential/` folder named after the driver (e.g. `aws.vue`); see the [Cloud Credentials docs](https://extensions.rancher.io/extensions/next/provisioning/cloud-credential) linked above.

### Scaffolding a new provider package

1. Copy `pkg/capa` to `pkg/<provider>` and update `package.json` (`name`, `description`, catalog annotations, icon) and `index.ts` (schema/provisioner IDs).
2. Define your CRD-shaped TypeScript types (mirroring `pkg/capa/types/capa.ts`) for the provider's infrastructure-cluster and machine-template specs.
3. Implement `provisioner.ts`, the form components, and `l10n/en-us.yaml` strings for your provider's fields.
4. Add validators for anything the built-in form validation doesn't cover (`validators.ts`).
5. Rely on the shared `rke2.vue` wizard for everything else — you're only supplying the provider-specific pieces above.

### Local development

```sh
yarn install
yarn dev          # serves the extension(s) under pkg/ for local testing against a Rancher instance
yarn build         # production build
yarn build-pkg     # build individual extension package(s)
yarn lint          # eslint over pkg/capa (adjust the script/path for a new package)
yarn publish-pkgs  # package + publish extension chart(s), used by CI
```

`yarn dev` runs `@rancher/shell`'s dev server, which serves your extension(s) so they can be loaded into a running Rancher UI for local testing — see the [Rancher Extensions developer docs](https://github.com/rancher/dashboard) in the `dashboard` repo (`shell/`) for the underlying extension framework, and the [Cluster API documentation](https://cluster-api.sigs.k8s.io/) for the upstream CRDs/concepts your provider extension will surface.
