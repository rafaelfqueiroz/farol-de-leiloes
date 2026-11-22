// TESTING §6, journey 6 "Export my data and delete my account" and the sign-up that accepts the
// terms (SPEC-010 BR-010-01, BR-010-02, BR-010-04, BR-010-09..14, BR-010-27). Through the real
// screens of the stack: the web app, its BFF, the real API and a throwaway MongoDB; the providers
// are fakes (compose.e2e.yml). Each test signs up its OWN account, so nothing here touches the seeded
// ones and the tests do not depend on each other.
//
// The stack runs no export worker (DATA_EXPORT_ENABLED=false, AR-04) and has no private bucket, so an
// export stays "Preparando seu arquivo": the file, its 60-second link and its expiry are the
// integration specs' (backend) and the component tests'. Google is not driven: its re-authentication
// is covered by the state-cookie unit specs and the privacy page's component tests.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PASSWORD = 'Farol-E2E-privacidade-2026';

/** Writes a screenshot when E2E_SCREENSHOT_DIR is set: the pictures of the pull request (DS-30). */
async function shoot(page: Page, name: string, scheme: 'light' | 'dark', project: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.emulateMedia({ colorScheme: scheme });
  await page.screenshot({ path: join(dir, `${name}.${project}.${scheme}.png`), fullPage: true });
}

function uniqueEmail(project: string, label: string): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${label}.${project}.${suffix}@farol.test`;
}

async function signUp(page: Page, email: string, { whatsapp = false } = {}) {
  await page.goto('/register');
  await page.getByLabel('Nome').fill('Pessoa Teste E2E');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/^Senha/).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
  // the versions in force are read from the API: the button waits for them
  await expect(page.getByText(/Versões vigentes: termos/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^Li e aceito os Termos de uso/ }).check();
  if (whatsapp) {
    await page
      .getByRole('checkbox', { name: 'Quero receber avisos por WhatsApp (opcional).' })
      .check();
  }
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.waitForURL('**/verify-email');
}

test.describe('the public documents (BR-010-02)', () => {
  test('open from the footer of a public page, with no login, and show the version in force', async ({
    page,
  }) => {
    await page.goto('/plans');
    const footer = page.getByRole('contentinfo');

    await footer.getByRole('link', { name: 'Termos de uso' }).click();
    await expect(page).toHaveURL(/\/termos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible();
    await expect(page.getByText(/^Versão \d/)).toBeVisible();
    await expect(
      page.getByText(/Em vigor desde \d{2}\/\d{2}\/\d{4} \(horário de Brasília\)/),
    ).toBeVisible();

    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Política de privacidade' })
      .click();
    await expect(page).toHaveURL(/\/privacidade$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Política de Privacidade' }),
    ).toBeVisible();
    // BR-010-06: the field-to-purpose table of the policy is on the page
    await expect(page.getByRole('columnheader', { name: 'Finalidade' }).first()).toBeVisible();
  });

  test('the sign-up and sign-in screens end with the same footer', async ({ page }) => {
    for (const path of ['/register', '/login']) {
      await page.goto(path);
      await expect(
        page.getByRole('contentinfo').getByRole('link', { name: 'Termos de uso' }),
      ).toBeVisible();
    }
  });
});

test.describe('sign-up with the terms (BR-010-01, BR-010-27)', () => {
  test('nothing is sent without the terms; accepted, the account exists with its acceptances and a declined WhatsApp', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    const email = uniqueEmail(project, 'cadastro');
    await page.goto('/register');
    await page.getByLabel('Nome').fill('Pessoa Teste E2E');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel(/^Senha/).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await expect(page.getByText(/Versões vigentes: termos/)).toBeVisible();
    // the WhatsApp box is its own choice and never ticked for the person
    await expect(
      page.getByRole('checkbox', { name: 'Quero receber avisos por WhatsApp (opcional).' }),
    ).not.toBeChecked();

    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByText('Aceite os termos e a política para criar a conta.')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await shoot(page, 'register-terms-error', 'light', project);
    await shoot(page, 'register-terms-error', 'dark', project);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    await page.getByRole('checkbox', { name: /^Li e aceito os Termos de uso/ }).check();
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.waitForURL('**/verify-email');

    // BR-010-04: the account sees what it accepted, when (Brasília time) and how
    await page.goto('/profile/privacidade');
    // a table from `sm` up, cards on a 360 px phone: the visible one shows both documents
    const section = page.getByRole('region', { name: 'Aceites' });
    await expect(section.getByText('Cadastro com e-mail').filter({ visible: true })).toHaveCount(2);
    if (project === 'desktop') {
      const table = section.getByRole('table', { name: 'Aceites registrados' });
      await expect(table.getByRole('row')).toHaveCount(3); // the header and the two documents
      await expect(
        table.getByRole('columnheader', { name: 'Aceito em (horário de Brasília)' }),
      ).toBeVisible();
    }
    // BR-010-27: not asked, so no consent: the switch is off
    await expect(
      page.getByRole('switch', { name: 'Receber avisos por WhatsApp' }),
    ).not.toBeChecked();
  });

  test('a ticked WhatsApp box is a consent the account can withdraw from its privacy page', async ({
    page,
  }, testInfo) => {
    await signUp(page, uniqueEmail(testInfo.project.name, 'whatsapp'), { whatsapp: true });
    await page.goto('/profile/privacidade');
    const toggle = page.getByRole('switch', { name: 'Receber avisos por WhatsApp' });
    await expect(toggle).toBeChecked();
    await expect(page.getByText('Consentimento ativo')).toBeVisible();

    await toggle.click();

    await expect(toggle).not.toBeChecked();
    await expect(page.getByText('Sem consentimento')).toBeVisible();
    await expect(
      page.getByText(/Cancelado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(horário de Brasília\)/),
    ).toBeVisible();
    // it is recorded: a reload says the same
    await page.reload();
    await expect(
      page.getByRole('switch', { name: 'Receber avisos por WhatsApp' }),
    ).not.toBeChecked();
  });
});

test.describe('journey 6: export my data and delete my account (BR-010-08..14)', () => {
  test('sees the data, asks for the export, and deletes the account with the password: the session ends and the account cannot sign in', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    const email = uniqueEmail(project, 'exclusao');
    await signUp(page, email);
    await page.goto('/profile/privacidade');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacidade e dados' }),
    ).toBeVisible();

    // BR-010-08: what is held about the account, at once
    const data = page.getByRole('region', { name: 'Seus dados' });
    await expect(data.getByText(email)).toBeVisible();
    await expect(data.getByText('Pessoa Teste E2E')).toBeVisible();
    await expect(data.getByText('E-mail e senha')).toBeVisible();
    await shoot(page, 'privacy-page', 'light', project);
    await shoot(page, 'privacy-page', 'dark', project);

    // BR-010-09, BR-010-11: ask for the export; without a worker it stays being prepared
    await page.getByRole('button', { name: 'Pedir exportação' }).click();
    await expect(page.getByText('Preparando seu arquivo', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Preparando seu arquivo' }),
    ).toHaveCount(1);
    // one live export per account: after a reload the same one is shown, not a second request
    await page.reload();
    await expect(page.getByText('Preparando seu arquivo', { exact: true }).first()).toBeVisible();

    // BR-010-13: the identity is proved again, and the box is part of it
    await page.getByRole('button', { name: 'Excluir minha conta' }).first().click();
    const dialog = page.getByRole('alertdialog', { name: 'Excluir sua conta?' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Excluir minha conta' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Sua senha atual').fill('uma-senha-errada');
    await dialog.getByRole('checkbox', { name: 'Entendo que não dá para desfazer.' }).check();
    await shoot(page, 'delete-dialog', 'light', project);
    await shoot(page, 'delete-dialog', 'dark', project);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // a wrong password is a field error; nothing was closed
    await expect(dialog.getByLabel('Sua senha atual')).toHaveAccessibleDescription(
      'Senha incorreta.',
    );
    await expect(page).toHaveURL(/\/profile\/privacidade$/);
    const axe = await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    await dialog.getByLabel('Sua senha atual').fill(PASSWORD);
    await confirm.click();

    // BR-010-14: closed at once; the session is gone and the browser is on the closed-account screen
    await page.waitForURL('**/conta-encerrada');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sua conta foi encerrada' }),
    ).toBeVisible();
    await shoot(page, 'account-closed', 'light', project);
    await shoot(page, 'account-closed', 'dark', project);
    const closed = await page.request.get('/api/auth/me');
    expect(closed.status()).toBe(401);

    // every way back in is refused
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel(/^Senha/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
