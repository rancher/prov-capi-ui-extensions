import ClusterManagerCreatePagePo from '@rancher/cypress/e2e/po/edit/provisioning.cattle.io.cluster/create/cluster-create.po';
import LabeledSelectPo from '@rancher/cypress/e2e/po/components/labeled-select.po';
import LabeledInputPo from '@rancher/cypress/e2e/po/components/labeled-input.po';
import AsyncButtonPo from '@rancher/cypress/e2e/po/components/async-button.po';

/** The provisioner id the extension registers (CAPAProvisioner.ID in pkg/capa/provisioner.ts). */
export const CAPA_PROVISIONER = 'awsmachinetemplate';

/** The card label on the Cluster Create page (capa.label in pkg/capa/l10n/en-us.yaml). */
export const CAPA_CARD_LABEL = 'CAPI AWS';

/** True when the form control `el` is labelled exactly `label` (sentence case, without the trailing "*"). */
const hasLabel = (el: HTMLElement, label: string) => {
  const text = el.querySelector('label')?.textContent || '';

  return text.replace('*', '').trim() === label;
};

/**
 * The create/edit form the CAPA provisioner plugs into shell's RKE2 cluster page.
 *
 * Most of the form comes from pkg/capa, which has few data-testids, so controls are found by their
 * visible label. Labels are sentence case and come from pkg/capa/l10n/en-us.yaml.
 */
export default class CruCapaPo extends ClusterManagerCreatePagePo {
  static createUrl(clusterId = '_') {
    return `${ ClusterManagerCreatePagePo.url(clusterId) }?type=${ CAPA_PROVISIONER }&rkeType=rke2`;
  }

  static goToCreate(clusterId = '_') {
    return cy.visit(CruCapaPo.createUrl(clusterId));
  }

  /** The provisioner card on the Cluster Create grid. */
  static card() {
    return cy.get(`[data-testid="cluster-manager-create-grid-${ CAPA_CARD_LABEL }"]`);
  }

  constructor(clusterId = '_') {
    super(clusterId, `type=${ CAPA_PROVISIONER }&rkeType=rke2`);
  }

  credentialSelect(): LabeledSelectPo {
    return new LabeledSelectPo('[data-testid="cluster-prov-select-credential"]', this.self());
  }

  selectCredential(label: string) {
    this.credentialSelect().toggle();

    return this.credentialSelect().clickOptionWithLabel(label);
  }

  clusterName(): LabeledInputPo {
    return this.nameNsDescription().name();
  }

  /** A LabeledSelect found by the exact text of its label, ignoring the required-field asterisk. */
  labeledSelect(label: string): LabeledSelectPo {
    return new LabeledSelectPo(() => this.self().find('.labeled-select').filter((_, el) => hasLabel(el, label)));
  }

  /** A LabeledInput found by the exact text of its label, ignoring the required-field asterisk. */
  labeledInput(label: string): LabeledInputPo {
    return new LabeledInputPo(() => this.self().find('.labeled-input').filter((_, el) => hasLabel(el, label)).find('input'));
  }

  region(): LabeledSelectPo {
    return this.labeledSelect('Region');
  }

  instanceType(): LabeledSelectPo {
    return this.labeledSelect('Instance type');
  }

  iamInstanceProfile(): LabeledSelectPo {
    return this.labeledSelect('IAM Instance Profile Name');
  }

  ami(): LabeledInputPo {
    return this.labeledInput('Machine image (AMI ID)');
  }

  /** The visible radio for a network strategy (the <input> itself is display: none). */
  networkMode(label: 'Managed network' | 'Unmanaged network (manual configuration)') {
    return this.self().find(`[data-testid="${ label }"]`).closest('.radio-container').find('.radio-custom');
  }

  vpc(): LabeledSelectPo {
    return this.labeledSelect('VPC');
  }

  subnets(): LabeledSelectPo {
    return this.labeledSelect('Subnets');
  }

  /** A select's `loading` prop disables it, e.g. while instance types load from AWS. */
  waitForSelectReady(select: LabeledSelectPo) {
    return select.self().find('.v-select').should('not.have.class', 'vs--disabled');
  }

  createButton(): AsyncButtonPo {
    return new AsyncButtonPo('[data-testid="rke2-custom-create-save"]', this.self());
  }

  credentialErrorBanners() {
    return this.self().find('.banner.error');
  }
}
