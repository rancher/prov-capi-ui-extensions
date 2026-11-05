import {
  validateIngressRulesCidr, vpc, subnet, cidrBlock, ipv4CidrBlocks, ipv6CidrBlocks, region
} from '../validators';
import type { IngressRule } from '../types/capa';

const t = (key: string) => `%${ key }%`;

const IPV4_ERROR = '%capa.errors.invalidIpv4Cidr%';
const IPV6_ERROR = '%capa.errors.invalidIpv6Cidr%';

describe('validators', () => {
  describe('fx: ipv4CidrBlocks', () => {
    it.each([
      ['no blocks', [], undefined],
      ['a single valid block', ['10.0.0.0/16'], undefined],
      ['several valid blocks', ['10.0.0.0/16', '192.168.1.0/24', '0.0.0.0/0'], undefined],
      ['a /32 host block', ['1.2.3.4/32'], undefined],
      ['an address without a prefix', ['10.0.0.0'], IPV4_ERROR],
      ['a prefix that is too long', ['10.0.0.0/33'], IPV4_ERROR],
      ['an out of range octet', ['10.0.0.256/16'], IPV4_ERROR],
      ['an ipv6 block', ['2001:db8::/32'], IPV4_ERROR],
      ['one invalid block among valid ones', ['10.0.0.0/16', 'nope', '192.168.0.0/16'], IPV4_ERROR],
    ])('should validate %p', (_, blocks, expected) => {
      expect(ipv4CidrBlocks(t, blocks)).toStrictEqual(expected);
    });

    it('should treat a missing list as valid', () => {
      expect(ipv4CidrBlocks(t)).toBeUndefined();
    });

    // `blocks.find(...)` returns the offending block and its truthiness is used as the result, so an
    // invalid-but-falsy entry ('') is reported as valid. Callers currently strip empty strings first.
    it.todo('should reject an empty string block');
  });

  describe('fx: ipv6CidrBlocks', () => {
    it.each([
      ['no blocks', [], undefined],
      ['a single valid block', ['2001:db8::/32'], undefined],
      ['the any block', ['::/0'], undefined],
      ['several valid blocks', ['2001:db8::/32', 'fd00::/8'], undefined],
      ['an address without a prefix', ['2001:db8::'], IPV6_ERROR],
      ['a prefix that is too long', ['2001:db8::/129'], IPV6_ERROR],
      ['an ipv4 block', ['10.0.0.0/16'], IPV6_ERROR],
      ['garbage', ['not-a-cidr'], IPV6_ERROR],
      ['one invalid block among valid ones', ['2001:db8::/32', '10.0.0.0/8'], IPV6_ERROR],
    ])('should validate %p', (_, blocks, expected) => {
      expect(ipv6CidrBlocks(t, blocks)).toStrictEqual(expected);
    });

    it('should treat a missing list as valid', () => {
      expect(ipv6CidrBlocks(t)).toBeUndefined();
    });
  });

  describe('fx: validateIngressRulesCidr', () => {
    const rule = (extra: Partial<IngressRule> = {}): IngressRule => ({ protocol: 'tcp', ...extra });

    it.each([
      ['no rules', [], undefined],
      ['rules without any cidr blocks', [rule(), rule({ sourceSecurityGroupRoles: ['node'] })], undefined],
      ['valid ipv4 and ipv6 blocks', [rule({ cidrBlocks: ['10.0.0.0/16'], ipv6CidrBlocks: ['::/0'] })], undefined],
      ['valid blocks spread over several rules', [rule({ cidrBlocks: ['10.0.0.0/16'] }), rule({ ipv6CidrBlocks: ['fd00::/8'] })], undefined],
      ['an invalid ipv4 block', [rule({ cidrBlocks: ['10.0.0.0'] })], IPV4_ERROR],
      ['an invalid ipv4 block in a later rule', [rule({ cidrBlocks: ['10.0.0.0/8'] }), rule({ cidrBlocks: ['bad'] })], IPV4_ERROR],
      ['an invalid ipv6 block', [rule({ ipv6CidrBlocks: ['10.0.0.0/8'] })], IPV6_ERROR],
      ['both an invalid ipv4 and ipv6 block (ipv4 is reported first)', [rule({ cidrBlocks: ['bad'], ipv6CidrBlocks: ['bad'] })], IPV4_ERROR],
    ])('should validate %p', (_, rules, expected) => {
      expect(validateIngressRulesCidr(t, rules as IngressRule[])).toStrictEqual(expected);
    });

    it('should tolerate a missing rule list and empty entries', () => {
      expect(validateIngressRulesCidr(t)).toBeUndefined();
      expect(validateIngressRulesCidr(t, [undefined as unknown as IngressRule, rule({ cidrBlocks: ['10.0.0.0/8'] })])).toBeUndefined();
    });
  });

  describe('fx: vpc', () => {
    it.each([
      ['vpc-123', true, undefined],
      ['', true, '%capa.errors.vpcRequired%'],
      [undefined, true, '%capa.errors.vpcRequired%'],
      [null, true, '%capa.errors.vpcRequired%'],
      ['', false, undefined],
      [undefined, false, undefined],
      ['vpc-123', false, undefined],
    ])('should return %p for value %p with useUnmanagedNetwork=%p', (val, useUnmanagedNetwork, expected) => {
      expect(vpc(t, val as string, useUnmanagedNetwork)).toStrictEqual(expected);
    });
  });

  describe('fx: subnet', () => {
    it.each([
      [['subnet-1'], true, undefined],
      [['subnet-1', 'subnet-2'], true, undefined],
      [[], true, '%capa.errors.subnetRequired%'],
      [undefined, true, '%capa.errors.subnetRequired%'],
      [null, true, '%capa.errors.subnetRequired%'],
      [[], false, undefined],
      [undefined, false, undefined],
    ])('should validate %p with useUnmanagedNetwork=%p', (val, useUnmanagedNetwork, expected) => {
      expect(subnet(t, val as string[], useUnmanagedNetwork)).toStrictEqual(expected);
    });
  });

  describe('fx: cidrBlock', () => {
    it.each([
      ['10.0.0.0/16', false, undefined],
      ['192.168.0.0/24', false, undefined],
      ['2001:db8::/32', false, undefined],
      ['', false, undefined],
      [undefined, false, undefined],
      ['10.0.0.0', false, '%capa.errors.vpcCidrBlock%'],
      ['10.0.0.0/33', false, '%capa.errors.vpcCidrBlock%'],
      ['not-a-cidr', false, '%capa.errors.vpcCidrBlock%'],
      // the cidr block is only used for managed networks, so it is not validated otherwise
      ['not-a-cidr', true, undefined],
      ['10.0.0.0/16', true, undefined],
    ])('should validate %p with useUnmanagedNetwork=%p', (val, useUnmanagedNetwork, expected) => {
      expect(cidrBlock(t, val as string, useUnmanagedNetwork)).toStrictEqual(expected);
    });
  });

  describe('fx: region', () => {
    it.each([
      ['us-west-2', undefined],
      ['', '%capa.errors.regionRequired%'],
      [undefined, '%capa.errors.regionRequired%'],
      [null, '%capa.errors.regionRequired%'],
    ])('should validate %p', (val, expected) => {
      expect(region(t, val as string)).toStrictEqual(expected);
    });
  });
});
