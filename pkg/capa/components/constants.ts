export const SECURITY_GROUP_ROLES = [
  'node',
  'controlplane',
  'apiserver-lb',
  'lb',
] as const;

export const DEFAULT_CLUSTER_CONFIG = {
  spec: {
    network: {
      additionalNodeIngressRules: [
        {
          description:              'RKE2 supervisor API',
          protocol:                 'tcp',
          fromPort:                 9345,
          toPort:                   9345,
          sourceSecurityGroupRoles: ['controlplane', 'node'],
        },
        {
          description:              'ETCD client and peer',
          protocol:                 'tcp',
          fromPort:                 2379,
          toPort:                   2380,
          sourceSecurityGroupRoles: ['controlplane', 'node'],
        },
      ],
    },
    sshKeyName:               '', // empty string -> no ssh key. unset -> use "default" key
    controlPlaneLoadBalancer: {
      healthCheckProtocol: 'TCP',
      loadBalancerType:    'nlb',
      scheme:              'internal'
    },
  },
};

export const CNI_INGRESS_RULES = {
  calico: [
    {
      description: 'Calico VXLAN',
      protocol:    'udp',
      fromPort:    4789,
      toPort:      4789,
    },
    {
      description: 'Calico Typha',
      protocol:    'tcp',
      fromPort:    5473,
      toPort:      5473,
    },
  ],
  flannel: [
    {
      description: 'Flannel VXLAN',
      protocol:    'udp',
      fromPort:    4789,
      toPort:      4789,
    },
  ],
  canal: [
    {
      description: 'Canal VXLAN',
      protocol:    'udp',
      fromPort:    8472,
      toPort:      8472,
    },
  ],
  cilium: [
    {
      description: 'Cilium VXLAN',
      protocol:    'udp',
      fromPort:    8472,
      toPort:      8472,
    },
    {
      description: 'Cilium Healthcheck',
      protocol:    'tcp',
      fromPort:    4240,
      toPort:      4240,
    },
    {
      description: 'Cilium Healthcheck',
      protocol:    'icmp',
      fromPort:    0,
      toPort:      -1,
    },
    {
      description: 'Cilium Healthcheck',
      protocol:    'icmp',
      fromPort:    8,
      toPort:      -1,
    },
  ],
};
