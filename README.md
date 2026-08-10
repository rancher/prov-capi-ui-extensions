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

### Prerequisites

1. **Rancher** `>= 2.15.0` with the **UI Extensions** feature enabled (`ui-extensions-version >= 3.0.0 < 4.0.0`), on **Rancher Prime**.
2. **Rancher Turtles** installed on the local cluster, with the **AWS (CAPA)** infrastructure provider enabled. The provisioner card only appears once Rancher has a `CAPI_PROVIDER` resource named `aws` (see the `hidden` getter in `pkg/capa/provisioner.ts:81`) and this extension does not handle provider installation.
3. **This UI extension installed** from the Rancher Extensions catalog (or loaded via `yarn dev`/`serve-pkgs` for local testing — see [Local development](#local-development)).

### Creating a cluster

In Rancher, go to **Cluster Management > Create**. A **CAPI AWS** card appears in the cluster-type list (grouped with other CAPI providers) once the prerequisites above are met. Selecting it opens the standard RKE2 cluster creation wizard with CAPA-specific sections added:

 **AWS Cloud Credential** 
 - Rancher Turtles watches AWS cloud credentials and annotates them with `cluster-api.cattle.io/capi-static-identity-ref`, pointing at an `AWSClusterStaticIdentity` it creates for that credential. The extension polls for this annotation after you create or pick a credential, and creating the cluster is blocked until it appears (`capa.errors.missingIdentityRef` if it never does — check that Turtles/the AWS provider are healthy). 

**Basic tab**
- Pick the AWS Cloud Credential and Kubernetes version as usual. Selecting the credential triggers the Turtles identity-ref lookup described above and seeds the default AWS region from the credential.
- The extension automatically sets `agentConfig.cloud-provider-name: external` and injects the RKE2/K3s `machineSelectorConfig` needed to disable the in-tree cloud provider, plus an `additionalManifest` that installs the `aws-cloud-controller-manager` Helm chart.

**CAPI Cluster Configuration** (the AWS infrastructure cluster, `AWSCluster`)
- *General*: AWS **Region**, an optional default **SSH Key Name**, and additional AWS resource **tags**.
- *Network*:
  - **Managed network** (default): CAPA creates a new VPC, subnets and security groups for you.
  - **Unmanaged network**: bring your own VPC — you must pick an existing **VPC** and at least one **Subnet**; CAPA still creates the control-plane load balancer and security groups unless you override them.
  - Optional **IPv6** support (VPC/subnets must support it).
  - **Security Group Overrides**: use your own existing security groups for `node`, `controlplane`, `apiserver-lb`, or `lb` roles instead of letting CAPA manage them (only available in unmanaged network mode). Overriding a role's group disables the extension's ability to add ingress rules to it.
  - **Additional ingress rules** for the control plane, worker nodes, and the CNI (Calico/Flannel/Canal/Cilium — rules update automatically if you change the CNI plugin on the Basic tab). Sources can be CIDR blocks (IPv4/IPv6), other security group IDs/roles, or NAT gateway IPs.

**Machine Pools** (per pool, backed by an `AWSMachineTemplate`)
- *Instance*: EC2 **instance type**, **AMI** (auto-populated with the latest Ubuntu LTS AMI for the region unless you set one explicitly), **subnet**, public IP assignment, SSH key, **IAM instance profile**, and instance metadata (IMDS) token requirements.
- *Storage*: root volume size/type/encryption (with an optional KMS key), plus additional (non-root) volumes.
- *Advanced*: additional security groups, on-demand/spot/capacity-block market type (with max spot price), cloud-init settings, and additional resource tags.

Save the cluster once all sections validate. The extension creates the `AWSCluster` and `AWSMachineTemplate` resources and wires the `provisioning.cattle.io.cluster` to reference them.

### Editing a cluster

Infrastructure cluster edits are patched onto the existing `AWSCluster` (with basic 3-way conflict resolution if the CAPA controller changed the object concurrently). Because upstream CAPI machine templates are immutable, editing a machine pool's instance config creates a **new** `AWSMachineTemplate`, repoints the pool at it, and removes the old template only after the cluster save succeeds — so a failed save never leaves a pool pointing at a deleted template. Removing a pool deletes its associated machine template.

### Troubleshooting

Common validation/error messages (see `pkg/capa/l10n/en-us.yaml` under `capa.errors`) and what they mean:

| Message | Cause |
|---|---|
| Cloud provider must be set to External when using CAPA | `agentConfig.cloud-provider-name` isn't `external` — shouldn't happen via the UI; check any automation that pre-fills the cluster object. |
| RKE Config is missing required additional manifest / machine selector config | The CAPA-required manifest/selector config was removed from the cluster spec. |
| The selected cloud credential must contain a "..." annotation pointing to an AWSClusterStaticIdentity | Turtles hasn't annotated the credential yet — verify Turtles and the AWS infrastructure provider are running. |
| VPC/Subnet is required | Unmanaged network mode needs an explicit VPC and at least one subnet. |
| Invalid IPv4/IPv6 CIDR format | Check ingress rule CIDR blocks and the VPC CIDR block. |

---

## Building a similar extension for another provider

`pkg/capa` is a working reference implementation of Rancher's CAPI provisioner extension point. To support a different infrastructure provider (e.g. Azure/CAPZ, GCP/CAPG, vSphere/CAPV), you plug into the same three extension points, backed by that provider's own Cluster API CRDs.

### Concepts

- A Rancher-managed cluster is always a `provisioning.cattle.io.cluster` resource, whether it's a classic node-driver cluster or a CAPI-backed one. For CAPI-backed providers, Rancher Turtles additionally reconciles it into an upstream CAPI `Cluster` resource. That `Cluster`'s infrastructure is a separate, provider-specific resource (e.g. `AWSCluster`) that has no equivalent at all in the classic node-driver flow — this extension creates and manages it directly, and links it from `provisioning.cattle.io.cluster.spec.rkeConfig.infrastructureRef` (see `saveInfrastructureCluster` in `pkg/capa/utils.ts`).
- CAPI splits a cluster's responsibilities across three provider roles: **infrastructure**, **control plane**, and **bootstrap**. CAPA (AWS) only fills the infrastructure role — it owns `AWSCluster`/`AWSMachineTemplate` and knows how to talk to AWS. The control plane and bootstrap roles are filled by Rancher's own CAPR (Cluster API Provider RKE2), which this extension doesn't touch directly; that's why cluster creation still goes through the standard RKE2 wizard (Kubernetes version, RKE2/K3s config, etc.) with CAPA's sections layered in for the infrastructure-specific pieces. A provider extension for another infrastructure target (Azure/CAPZ, vSphere/CAPV, ...) would pair with CAPR the same way.
- **Infrastructure cluster**: the provider's cluster-scoped CRD (e.g. `AWSCluster`), referenced from `provisioning.cattle.io.cluster.spec.rkeConfig.infrastructureRef`.
- **Machine pool config**: the provider's machine-template CRD (e.g. `AWSMachineTemplate`), one per machine pool, referenced by `machinePool.machineConfigRef`.
- Rancher's `rke2.vue` edit view (in `@rancher/shell`) owns the overall cluster creation/edit wizard; your extension supplies extra sections and hooks into specific extension points rather than replacing the wizard.

### The three registration points

Everything is wired up in `pkg/capa/index.ts`, which is the pattern to copy:

```ts
export default function(plugin: IExtension): void {
  importTypes(plugin);        // auto-import model/detail/edit from folders
  plugin.metadata = require('./package.json');
  plugin.register('provisioner', CAPAProvisioner.ID, CAPAProvisioner);
  plugin.register('machine-config', CAPAProvisioner.ID, () => import('./machine-config/capa.vue'));
  plugin.addModelExtension('provisioning.cattle.io.cluster', CAPARKE2Cluster as ModelExtensionConstructor);
}
```

1. **`provisioner`** — a class implementing `IClusterProvisioner` (`@shell/core/types`). This is the main extension point: it supplies the schema IDs for your CRDs, the extra form sections, and hooks into the create/edit/save lifecycle. See `pkg/capa/provisioner.ts` (`CAPAProvisioner`) for a complete example, and `IClusterProvisioner` in `@rancher/shell/core/types-provisioning.ts` for the full interface with doc comments. Notable members used by CAPA:
   - `id` / `group` / `label` / `description` / `icon` / `hidden` — how/whether the provider's card shows up in the cluster-type picker. CAPA hides itself until the `aws` `CAPI_PROVIDER` resource exists (i.e. until Turtles has deployed that infra provider).
   - `machineConfigSchema` / `clusterSchema` (a.k.a. `infrastructureClusterSchema`) — getters returning the Norman schema for your machine-template and infrastructure-cluster types.
   - `extensionInfrastructureSection` / `extensionInfrastructureSectionProps` — the Vue component (and its props) rendered for infrastructure-cluster-specific config, e.g. `InfrastructureClusterConfiguration.vue`.
   - `extensionProvisioningSection` / `extensionProvisioningSectionProps` — a component for provisioning-cluster-level config/validation not tied to the infrastructure cluster (CAPA uses this purely for banners/validation of the provisioning cluster — see `ProvisioningClusterConfiguration.vue`).
   - `createMachinePoolMachineConfig`, `saveMachinePoolConfigs`, `cleanupMachinePools` — override how machine-template resources are created/saved/cleaned up per pool (`pkg/capa/utils.ts`).
   - `registerInitHooks` / `registerSaveHooks` — register functions that run when the cluster form initializes / before the cluster is saved, e.g. to load or persist the infrastructure cluster resource alongside the `provisioning.cattle.io.cluster`.
   - `isUpstreamCAPIProvider: true` — tells the shared wizard this provider is CAPI-backed (changes some validation/UI behavior in `rke2.vue`).

2. **`machine-config`** — a Vue component registered under the same provider ID, rendered once per machine pool to edit that pool's machine-template spec. See `pkg/capa/machine-config/capa.vue` plus its child sections (`InstanceConfigSection.vue`, `StorageSection.vue`, `AdvancedSection.vue`).

3. **Model extension** — a class implementing `IClusterModelExtension`, registered via `plugin.addModelExtension('provisioning.cattle.io.cluster', ...)`, that customizes cluster-model behavior for clusters using your provider (`useFor` matches on `cluster.machineProvider`). See `pkg/capa/model-extension/provisioning.cattle.io.cluster.ts` (`CAPARKE2Cluster`) — CAPA uses it to control `detailTabs` and to hide edit/view-config actions when the cluster has no cloud credential reference yet.

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
