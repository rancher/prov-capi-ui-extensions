/**
 * Browser-side stubs that let the CAPA create flow run end to end with no AWS account and no
 * side effects on the Rancher it runs against.
 *
 * - stubAwsApis(): answers every AWS call the form makes through /meta/proxy (see blueprints/aws-responses.ts)
 * - stubAwsCloudCredential(): adds a fake AWS cloud credential, already annotated with the Turtles identity
 *   reference the form needs, to the credentials Rancher returns
 * - interceptCapaWrites(): answers the AWSMachineTemplate / AWSCluster / provisioning cluster writes in the
 *   browser, so Create can be clicked and the request bodies asserted, without provisioning anything
 * - blockUnexpectedWrites(): fails any other write, so a change in the form can't quietly start creating resources
 */
import { EC2_RESPONSES, IAM_RESPONSES, KMS_RESPONSES, REGION } from '../blueprints/aws-responses';

export const CLUSTER_NAMESPACE = 'fleet-default';

export const TYPES = {
  machineTemplate: 'infrastructure.cluster.x-k8s.io.awsmachinetemplate',
  awsCluster:      'infrastructure.cluster.x-k8s.io.awscluster',
  provCluster:     'provisioning.cattle.io.cluster',
};

/** Aliases for the intercepted create requests, for use with cy.wait(). */
export const ALIASES = {
  machineTemplate: 'createAwsMachineTemplate',
  awsCluster:      'createAwsCluster',
  provCluster:     'createProvisioningCluster',
};

export const FAKE_CREDENTIAL = {
  id:          'cattle-global-data:cc-e2ecapa',
  name:        'e2e-capa-credential',
  // Turtles sets this on every AWS cloud credential to name the AWSClusterStaticIdentity it created
  identityRef: 'cc-e2ecapa',
};

const xml = (body: string) => ({
  statusCode: 200, headers: { 'content-type': 'text/xml;charset=UTF-8' }, body
});

const action = (body: unknown) => new URLSearchParams(String(body)).get('Action') || '';

/**
 * Answer EC2, IAM and KMS calls from the canned responses. Unknown calls fail loudly.
 *
 * Each call is aliased by its action, e.g. `cy.wait('@DescribeVpcs')`.
 */
export function stubAwsApis() {
  cy.intercept('POST', /\/meta\/proxy\/ec2\./, (req) => {
    const resp = EC2_RESPONSES[action(req.body)];

    req.alias = action(req.body);
    req.reply(resp ? xml(resp) : { statusCode: 501, body: `No EC2 stub for ${ action(req.body) }` });
  });

  cy.intercept('POST', /\/meta\/proxy\/iam\./, (req) => {
    const resp = IAM_RESPONSES[action(req.body)];

    req.alias = action(req.body);
    req.reply(resp ? xml(resp) : { statusCode: 501, body: `No IAM stub for ${ action(req.body) }` });
  });

  cy.intercept('POST', /\/meta\/proxy\/kms\./, (req) => {
    const target = String(req.headers['x-amz-target']);
    const resp = KMS_RESPONSES[target];

    req.alias = target.split('.').pop();
    req.reply(resp ? {
      statusCode: 200, headers: { 'content-type': 'application/x-amz-json-1.1' }, body: resp
    } : { statusCode: 501, body: `No KMS stub for ${ target }` });
  });
}

/** Wait for the lookups the create form makes once a credential is chosen. */
export function waitForAwsLookups() {
  ['DescribeRegions', 'DescribeVpcs', 'DescribeSubnets', 'DescribeSecurityGroups', 'DescribeImages', 'DescribeInstanceTypes', 'ListInstanceProfiles']
    .forEach((alias) => cy.wait(`@${ alias }`));
}

function fakeCredential(baseUrl: string) {
  const self = `${ baseUrl }/v3/cloudCredentials/${ FAKE_CREDENTIAL.id }`;

  return {
    id:                        FAKE_CREDENTIAL.id,
    type:                      'cloudCredential',
    baseType:                  'cloudCredential',
    name:                      FAKE_CREDENTIAL.name,
    amazonec2credentialConfig: { defaultRegion: REGION },
    annotations:               {
      'cluster-api.cattle.io/capi-static-identity-ref': FAKE_CREDENTIAL.identityRef,
      'provisioning.cattle.io/driver':                  'aws',
    },
    labels:  { 'cattle.io/creator': 'norman' },
    created: '2026-01-01T00:00:00Z',
    links:   {
      self, update: self, remove: self
    },
  };
}

/** Add FAKE_CREDENTIAL to the cloud credential list, and serve it by id. */
export function stubAwsCloudCredential() {
  cy.intercept('GET', /\/v3\/cloudcredentials(\?|$)/i, (req) => {
    req.continue((res) => {
      const base = new URL(req.url).origin;

      res.body.data = [...(res.body.data || []), fakeCredential(base)];
    });
  }).as('cloudCredentials');

  cy.intercept('GET', new RegExp(`/v3/cloudcredentials/${ FAKE_CREDENTIAL.id }`, 'i'), (req) => {
    req.reply(fakeCredential(new URL(req.url).origin));
  }).as('cloudCredential');
}

/** A Steve-shaped echo of a created resource, close enough for the form to carry on. */
function created(type: string, body: any, url: string, n: number) {
  const namespace = body.metadata?.namespace || CLUSTER_NAMESPACE;
  const name = body.metadata?.name || `${ body.metadata?.generateName || 'e2e-' }${ String(n).padStart(5, '0') }`;
  const collection = url.split('?')[0].replace(new RegExp(`/${ namespace }$`), '');
  const self = `${ collection }/${ namespace }/${ name }`;

  return {
    ...body,
    id:       `${ namespace }/${ name }`,
    type,
    metadata: {
      ...body.metadata, name, namespace, uid: `e2e-uid-${ n }`, resourceVersion: '1', creationTimestamp: new Date().toISOString()
    },
    links: {
      self, update: self, remove: self, view: self
    },
  };
}

/** Answer the three CAPA create requests in the browser. Wait on them with ALIASES. */
export function interceptCapaWrites() {
  let n = 0;
  const reply = (type: string) => (req: any) => req.reply(201, created(type, req.body, req.url, n++));

  cy.intercept('POST', /\/v1\/infrastructure\.cluster\.x-k8s\.io\.awsmachinetemplates(\/[^/?]+)?(\?|$)/, reply(TYPES.machineTemplate)).as(ALIASES.machineTemplate);
  cy.intercept('POST', /\/v1\/infrastructure\.cluster\.x-k8s\.io\.awsclusters(\/[^/?]+)?(\?|$)/, reply(TYPES.awsCluster)).as(ALIASES.awsCluster);
  cy.intercept('POST', /\/v1\/provisioning\.cattle\.io\.clusters(\/[^/?]+)?(\?|$)/, reply(TYPES.provCluster)).as(ALIASES.provCluster);
}

/**
 * Reject every write the suite doesn't expect, before it reaches Rancher. Register this FIRST:
 * Cypress runs the most recently registered matching intercept first, so the specific stubs above
 * still answer the writes they cover.
 */
export function blockUnexpectedWrites(): string[] {
  // login, preferences, the "who am I" lookup and the (stubbed) AWS proxy
  const allowed = /\/v[13]-public\/|\/v[13]\/userpreferences|\/v1\/ext\.cattle\.io\.selfuser|\/meta\/proxy\//;
  const blocked: string[] = [];

  cy.intercept({ method: /^(POST|PUT|PATCH|DELETE)$/, url: /\/(v1|v3)\// }, (req) => {
    if (allowed.test(req.url)) {
      return;
    }

    blocked.push(`${ req.method } ${ req.url }`);
    req.reply({ statusCode: 418, body: { message: `e2e: blocked unexpected ${ req.method } ${ req.url }` } });
  });

  return blocked;
}
