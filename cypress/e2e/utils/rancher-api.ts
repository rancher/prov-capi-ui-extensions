/**
 * Minimal Rancher API helpers
 *
 * @rancher/cypress's own API commands (cy.getRancherResource, cy.waitForResourceState, ...) read a
 * module-private `token` that cy.login() only assigns on its `cacheSession: true` branch, which
 * asserts the bootstrap-only "Welcome to Rancher" message. The instances this suite runs against are
 * already bootstrapped, so these helpers read the CSRF cookie themselves instead.
 */
import { LoginPagePo } from '@rancher/cypress/e2e/po/pages/login-page.po';
import { LONG_TIMEOUT_OPT } from '@rancher/cypress/support/utils/timeouts';

const api = () => Cypress.env('api');

/**
 * Log in as a local user through the UI.
 *
 * Not cy.login(): it asserts the exact body of the login request, and @rancher/shell 3.0.15 (Rancher
 * 2.16) added `configName` to it, so the assertion fails on newer Rancher even though login worked.
 * Its cached branch also asserts the bootstrap-only "Welcome to Rancher" message. This checks the
 * login response instead, which holds for every Rancher version.
 *
 * When an external auth provider is enabled the local login form sits behind a "use a local user"
 * button. LoginPagePo.switchToLocal() looks for that button before the auth providers have loaded,
 * so wait for the page to settle on either the button or the form first.
 */
export function loginAsAdmin(username = Cypress.env('username'), password = Cypress.env('password')) {
  const loginPage = new LoginPagePo();

  cy.intercept('POST', '/v1-public/login*').as('loginReq');

  LoginPagePo.goTo();
  loginPage.checkIsCurrentPage();

  cy.get('[data-testid="login-useLocal"], [data-testid="login-submit"]', LONG_TIMEOUT_OPT).should('be.visible');
  loginPage.switchToLocal();

  loginPage.username().set(username);
  // PasswordPo.set() would print the password in the command log
  cy.get('[data-testid="local-login-password"] input').type(password, { log: false });
  loginPage.submitButton().expectToBeEnabled();
  loginPage.submit();

  return cy.wait('@loginReq').its('response.statusCode').should('eq', 200);
}

/**
 * Rancher rejects mutating requests without the CSRF header. The cookie is set by login.
 */
function csrf(): Cypress.Chainable<string> {
  return cy.getCookie('CSRF').then((cookie) => {
    expect(cookie, 'CSRF cookie - is the session logged in?').to.not.equal(null);

    return cookie!.value;
  });
}

function apiRequest(options: Partial<Cypress.RequestOptions> & { url: string }): Cypress.Chainable<Cypress.Response<any>> {
  return csrf().then((value) => cy.request({
    ...options,
    url:     `${ api() }${ options.url }`,
    headers: {
      'x-api-csrf': value,
      Accept:       'application/json',
      ...(options.headers || {}),
    },
  }));
}

/** /rancherversion is public */
export function rancherVersion(): Cypress.Chainable<{ Version: string, RancherPrime: string }> {
  return cy.request({ url: `${ api() }/rancherversion` })
    .then((resp) => (typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body));
}

/** GET a resource, passing a 404 through rather than failing the test. */
export function getResource(prefix: string, resourceType: string, id?: string): Cypress.Chainable<Cypress.Response<any>> {
  return apiRequest({
    url:              `/${ prefix }/${ resourceType }${ id ? `/${ id }` : '' }`,
    failOnStatusCode: false,
  });
}
