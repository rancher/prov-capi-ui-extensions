# Using the extension: provisioning AWS clusters

### Prerequisites

1. **Rancher** `>= 2.15.0` with the **UI Extensions** feature enabled (`ui-extensions-version >= 3.0.0 < 4.0.0`), on **Rancher Prime**.
2. **Rancher Turtles** installed on the local cluster, with the **AWS (CAPA)** infrastructure provider enabled. The provisioner card only appears once Rancher has a `turtles-capi.cattle.io.capiprovider` resource named `aws` (see the `hidden` getter in `provisioner.ts:81`) and this extension does not handle provider installation.
3. **This UI extension installed** from the Rancher Extensions catalog (or loaded via `yarn dev`/`serve-pkgs` for local testing — see [Local development](../../README.md#local-development) in the project README).

### Creating a cluster

In Rancher, go to **Cluster Management > Create**. A **CAPI AWS** card appears in the cluster-type list (grouped with other CAPI providers) once the prerequisites above are met. Selecting it opens the standard RKE2 cluster creation wizard with CAPA-specific sections added:

 **AWS Cloud Credential** 
 - Rancher Turtles watches AWS cloud credentials and annotates them with `cluster-api.cattle.io/capi-static-identity-ref`, pointing at an `AWSClusterStaticIdentity` it creates for that credential. The extension looks for this annotation after you create or pick a credential, and creating the cluster is blocked until it appears (`capa.errors.missingIdentityRef` if it never does — check that Turtles/the AWS provider are healthy). 

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

Common validation/error messages (see `l10n/en-us.yaml` under `capa.errors`) and what they mean:

| Message | Cause |
|---|---|
| Cloud provider must be set to External when using CAPA | `agentConfig.cloud-provider-name` isn't `external` — shouldn't happen via the UI; check any automation that pre-fills the cluster object. |
| RKE Config is missing required additional manifest / machine selector config | The CAPA-required manifest/selector config was removed from the cluster spec. |
| The selected cloud credential must contain a "..." annotation pointing to an AWSClusterStaticIdentity | Turtles hasn't annotated the credential yet — verify Turtles and the AWS infrastructure provider are running. |
| VPC/Subnet is required | Unmanaged network mode needs an explicit VPC and at least one subnet. |
| Invalid IPv4/IPv6 CIDR format | Check ingress rule CIDR blocks and the VPC CIDR block. |
| No subnets available / nodes never launch, in a public-only VPC | Known issue: Public IP needs to be enabled on the machine pool if VPC only has public subnets ([#27](https://github.com/rancher/prov-capi-ui-extensions/issues/27)). |
