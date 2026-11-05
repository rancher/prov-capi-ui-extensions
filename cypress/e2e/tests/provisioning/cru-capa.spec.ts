import ClusterManagerCreatePagePo from '@rancher/cypress/e2e/po/edit/provisioning.cattle.io.cluster/create/cluster-create.po';
import { EXTRA_LONG_TIMEOUT_OPT, LONG_TIMEOUT_OPT } from '@rancher/cypress/support/utils/timeouts';

import CruCapaPo, { CAPA_CARD_LABEL, CAPA_PROVISIONER } from '../../po/cru-capa.po';
import {
  AMIS, INSTANCE_PROFILES, REGION, SUBNETS, VPC
} from '../../blueprints/aws-responses';
import {
  ALIASES, CLUSTER_NAMESPACE, FAKE_CREDENTIAL, blockUnexpectedWrites, interceptCapaWrites, stubAwsApis, stubAwsCloudCredential, waitForAwsLookups
} from '../../utils/capa-stubs';
import { loginAsAdmin } from '../../utils/rancher-api';

const CAPI_PROVIDERS_URL = /\/v1\/turtles-capi\.cattle\.io\.capiproviders(\?|$)/;

describe('CAPA provisioner', { testIsolation: false, tags: ['@adminUser'] }, () => {
  const createPage = new ClusterManagerCreatePagePo();
  const capaPage = new CruCapaPo();

  before(() => {
    loginAsAdmin();
  });

  describe('cluster create grid', () => {
    it('offers CAPI AWS when the aws CAPIProvider is installed', () => {
      // Without an AWS credential the form shows "create a new credential" instead of the select,
      // so don't depend on what the Rancher under test already has
      stubAwsCloudCredential();

      ClusterManagerCreatePagePo.goTo('_');
      createPage.waitForPage();

      CruCapaPo.card().should('be.visible').click();

      cy.url().should('include', `type=${ CAPA_PROVISIONER }`);
      capaPage.rke2PageTitle().should('include', 'Cluster API Provider AWS');
      capaPage.credentialSelect().checkVisible();
    });

    it('hides CAPI AWS when no aws CAPIProvider is installed', () => {
      cy.intercept('GET', CAPI_PROVIDERS_URL, (req) => {
        req.continue((res) => {
          res.body.data = (res.body.data || []).filter((p: any) => p.metadata?.name !== 'aws');
        });
      }).as('capiProviders');

      ClusterManagerCreatePagePo.goTo('_');
      createPage.waitForPage();
      cy.wait('@capiProviders', LONG_TIMEOUT_OPT);

      // Something else on the grid has rendered, so the CAPA card's absence is meaningful
      createPage.gridElementExistanceByName('Custom', 'exist');
      cy.contains('.grid .name', CAPA_CARD_LABEL).should('not.exist');
    });
  });

  describe('create form', () => {
    const clusterName = `e2e-capa-${ Date.now() }`;
    let blockedWrites: string[] = [];

    beforeEach(() => {
      blockedWrites = blockUnexpectedWrites();
      stubAwsApis();
      stubAwsCloudCredential();
      interceptCapaWrites();

      CruCapaPo.goToCreate();
      capaPage.waitForPage();
      capaPage.selectCredential(FAKE_CREDENTIAL.name);
      waitForAwsLookups();
    });

    afterEach(() => {
      cy.then(() => {
        expect(blockedWrites, `writes that would have reached Rancher: ${ blockedWrites.join(', ') }`).to.have.length(0);
      });
    });

    it('fills in defaults from AWS once a credential is chosen', () => {
      capaPage.region().checkOptionSelected(REGION);
      // The newest Ubuntu image is chosen by default, and labelled as such
      capaPage.ami().self().invoke('val').should('eq', `${ AMIS.latest } (Latest Ubuntu LTS)`);

      capaPage.iamInstanceProfile().toggle();
      capaPage.iamInstanceProfile().getOptionsAsStrings().should('deep.equal', INSTANCE_PROFILES);
      capaPage.iamInstanceProfile().toggle();

      capaPage.credentialErrorBanners().should('not.exist');
    });

    it('keeps Create disabled until the required fields are set', () => {
      capaPage.createButton().expectToBeDisabled();

      capaPage.clusterName().set(clusterName);
      capaPage.createButton().expectToBeDisabled();

      capaPage.iamInstanceProfile().toggle();
      capaPage.iamInstanceProfile().clickOptionWithLabel(INSTANCE_PROFILES[1]);
      capaPage.createButton().expectToBeEnabled();

      capaPage.clusterName().clear();
      capaPage.createButton().expectToBeDisabled();
    });

    it('lists VPCs, and the chosen VPC\'s subnets, for an unmanaged network', () => {
      capaPage.networkMode('Unmanaged network (manual configuration)').click();

      capaPage.vpc().toggle();
      capaPage.vpc().getOptions().should('have.length', 2);
      capaPage.vpc().getOptions().should('contain', `e2e-vpc (${ VPC.managed })`).and('contain', `e2e-default-vpc (${ VPC.default })`);
      capaPage.vpc().clickOptionWithLabel(VPC.managed);

      capaPage.subnets().toggle();
      capaPage.subnets().getOptions().should('have.length', 2);
      capaPage.subnets().getOptions().should('contain', SUBNETS.a).and('contain', SUBNETS.b)
        .and('not.contain', SUBNETS.other);
      capaPage.subnets().toggle();
    });

    it('creates the AWSMachineTemplate, AWSCluster and provisioning cluster', () => {
      capaPage.clusterName().set(clusterName);
      capaPage.iamInstanceProfile().toggle();
      capaPage.iamInstanceProfile().clickOptionWithLabel(INSTANCE_PROFILES[1]);
      capaPage.waitForSelectReady(capaPage.instanceType());

      capaPage.createButton().expectToBeEnabled();
      capaPage.createButton().click();

      cy.wait(`@${ ALIASES.machineTemplate }`, LONG_TIMEOUT_OPT).then(({ request }) => {
        const spec = request.body.spec.template.spec;

        expect(request.body.metadata.namespace, 'template namespace').to.eq(CLUSTER_NAMESPACE);
        expect(spec.ami.id, 'AMI').to.eq(AMIS.latest);
        expect(spec.iamInstanceProfile, 'IAM instance profile').to.eq(INSTANCE_PROFILES[1]);
        expect(spec.instanceType, 'instance type').to.eq('t3.medium');
      });

      cy.wait(`@${ ALIASES.awsCluster }`, LONG_TIMEOUT_OPT).then(({ request }) => {
        expect(request.body.metadata.name, 'AWSCluster name').to.eq(clusterName);
        expect(request.body.metadata.namespace, 'AWSCluster namespace').to.eq(CLUSTER_NAMESPACE);
        expect(request.body.spec.region, 'region').to.eq(REGION);
        expect(request.body.spec.identityRef, 'identity from the credential').to.deep.eq({ name: FAKE_CREDENTIAL.identityRef, kind: 'AWSClusterStaticIdentity' });
      });

      cy.wait(`@${ ALIASES.provCluster }`, EXTRA_LONG_TIMEOUT_OPT).then(({ request }) => {
        const pools = request.body.spec.rkeConfig.machinePools;

        expect(request.body.metadata.name, 'cluster name').to.eq(clusterName);
        expect(request.body.spec.cloudCredentialSecretName, 'credential').to.eq(FAKE_CREDENTIAL.id);
        expect(pools, 'machine pools').to.have.length(1);
        expect(pools[0].machineConfigRef.kind, 'pool machine config kind').to.eq('AWSMachineTemplate');
      });
    });
  });
});
