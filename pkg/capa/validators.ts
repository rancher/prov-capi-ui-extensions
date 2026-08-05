import ipaddr from 'ipaddr.js';
import type { IngressRule, Translator } from './types/capa';

const ipv4CidrBlocks = (t: Translator, blocks: string[] = []): string | undefined => {
  try {
    const invalid = blocks.find((cidr) => !ipaddr.IPv4.isValidCIDR(cidr));

    return invalid ? t('capa.errors.invalidIpv4Cidr') : undefined;
  } catch {
    return t('capa.errors.invalidIpv4Cidr');
  }
};

const ipv6CidrBlocks = (t: Translator, blocks: string[] = []): string | undefined => {
  try {
    const invalid = blocks.find((cidr) => !ipaddr.IPv6.isValidCIDR(cidr));

    return invalid ? t('capa.errors.invalidIpv6Cidr') : undefined;
  } catch {
    return t('capa.errors.invalidIpv6Cidr');
  }
};

const validateIngressRulesCidr = (t: Translator, additionalRules: IngressRule[] = []): string | undefined => {
  const allIpv4 = additionalRules.flatMap((r = {} as IngressRule) => r.cidrBlocks || []);
  const allIpv6 = additionalRules.flatMap((r = {} as IngressRule) => r.ipv6CidrBlocks || []);

  return ipv4CidrBlocks(t, allIpv4) ?? ipv6CidrBlocks(t, allIpv6);
};

const vpc = (t: Translator, val: string, useUnmanagedNetwork: boolean): string | undefined => {
  if (!useUnmanagedNetwork) {
    return undefined;
  }

  return val && val !== '' ? undefined : t('capa.errors.vpcRequired');
};

const subnet = (t: Translator, val: string[], useUnmanagedNetwork: boolean): string | undefined => {
  if (!useUnmanagedNetwork) {
    return undefined;
  }

  return val && val.length > 0 ? undefined : t('capa.errors.subnetRequired');
};

const cidrBlock = (t: Translator, val: string, useUnmanagedNetwork: boolean): string | undefined => {
  if (useUnmanagedNetwork || !val) {
    return undefined;
  }

  try {
    return ipaddr.isValidCIDR(val) ? undefined : t('capa.errors.vpcCidrBlock');
  } catch {
    return t('capa.errors.vpcCidrBlock');
  }
};

const region = (t: Translator, val: string): string | undefined => {
  return val && val !== '' ? undefined : t('capa.errors.regionRequired');
};

export {
  validateIngressRulesCidr, vpc, subnet, cidrBlock, ipv4CidrBlocks, ipv6CidrBlocks, region
};
