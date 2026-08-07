export const CAPA = {
  CAPA_CLUSTER_PREFIX: 'sigs.k8s.io/cluster-api-provider-aws/cluster', // CAPA assigns this to VPCs it creates
  IDENTITY_REF:        'cluster-api.cattle.io/capi-static-identity-ref' // Rancher turtles assigns this to cloud credentials to map them to aws identity resources
};
