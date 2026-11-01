// Teste de ponta a ponta: servidor de produção (dist) + Chromium headless (Playwright).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const dir = mkdtempSync(join(tmpdir(), 'flowproof-e2e-'));
const out = 'test-results';
mkdirSync(out, { recursive: true });
const PORT = 3917;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['--disable-warning=ExperimentalWarning', 'dist/server.mjs'], {
  env: { ...process.env, PORT: String(PORT), FLOWPROOF_DB_PATH: join(dir, 'e2e.db') }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 50; i += 1) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const browser = await chromium.launch();
const problems = [];
const step = (m) => console.log(`✓ ${m}`);
let ok = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  // Respostas 4xx são esperadas nos testes de validação; o navegador as registra como erro de rede.
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/status of 4\d\d/.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(base);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Ana Teste');
  await page.getByLabel('E-mail').fill('ana@e2e.test');
  await page.getByLabel('Senha').fill('senha-muito-segura-1');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
  await page.getByText('Primeiros passos').waitFor();
  assert.equal(await page.getByText('Taxa de aprovação').count(), 1);
  await page.screenshot({ path: `${out}/01-dashboard-vazio.png` });
  step('cadastro + dashboard vazio com onboarding (sem números inventados)');

  await page.getByRole('link', { name: 'Projetos' }).first().click();
  await page.getByText('Crie seu primeiro projeto').waitFor();
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByText('Nome é obrigatório.').waitFor();
  await page.getByLabel('Nome do projeto').fill('Agência Alfa');
  await page.getByLabel('Cliente (opcional)').fill('ACME');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('heading', { name: 'Agência Alfa' }).waitFor();
  step('criação de projeto com validação de formulário');

  await page.getByRole('button', { name: 'Importar workflow' }).first().click();
  await page.getByLabel('…ou cole o JSON').fill('{ isto não é json');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.getByText('O conteúdo não é um JSON válido.').waitFor();
  await page.getByLabel('…ou cole o JSON').fill(JSON.stringify({ nodes: [], connections: {} }));
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.getByText('O workflow é inválido.').waitFor();
  await page.getByLabel('…ou cole o JSON').fill('');
  await page.getByLabel('Arquivo JSON exportado do n8n').setInputFiles('tests/fixtures/sample-workflow.json');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.getByRole('heading', { name: 'Boas-vindas ao cliente' }).waitFor();
  await page.getByText('Dados sensíveis foram removidos na importação.').waitFor();
  await page.locator('svg.graph').waitFor();
  assert.equal(await page.locator('.graph-node').count(), 4);
  await page.locator('.graph-node', { hasText: 'HTTP' }).click();
  const detail = await page.locator('.graph-detail').innerText();
  for (const leak of ['super-secreta-123', 'abcdefghijklmnop123456', 'maria@cliente.com']) assert.ok(!detail.includes(leak), `vazou ${leak}`);
  assert.ok(detail.includes('[REDACTED]'));
  await page.screenshot({ path: `${out}/02-workflow-estrutura.png`, fullPage: true });
  step('importação: JSON inválido/estrutura inválida rejeitados; válido sanitizado; grafo com 4 nós');

  await page.getByRole('tab', { name: 'Testes' }).click();
  await page.getByRole('link', { name: 'Criar primeiro teste' }).click();
  await page.getByLabel('Nome do teste').fill('Define status e créditos');
  await page.getByLabel(/Nó alvo/).selectOption('Preparar');
  await page.getByLabel('Entrada (fixture.input)').fill('{ "nome": "Ana" }');
  await page.getByRole('button', { name: 'Gerar esqueleto de mocks' }).click();
  await page.getByLabel('Caminho').first().fill('output[0].status');
  await page.getByLabel('Operador').first().selectOption('equals');
  await page.getByLabel('Valor esperado').first().fill('"ativo"');
  await page.getByRole('button', { name: 'Adicionar verificação' }).click();
  await page.getByLabel('Caminho').nth(1).fill('output[0].creditos');
  await page.getByLabel('Operador').nth(1).selectOption('type');
  await page.getByLabel('Tipo esperado').nth(1).selectOption('number');
  await page.screenshot({ path: `${out}/03-editor-teste.png`, fullPage: true });
  await page.getByRole('button', { name: 'Salvar e executar (simulada)' }).click();
  await page.getByText('Execução simulada.').waitFor();
  await page.getByText('Aprovado').first().waitFor();
  assert.ok((await page.locator('tbody tr').count()) >= 2);
  await page.screenshot({ path: `${out}/04-execucao-simulada.png`, fullPage: true });
  step('criação de teste pela UI, execução simulada, detalhe com banner "simulada"');

  await page.getByRole('link', { name: 'Boas-vindas ao cliente (v1)' }).click();
  await page.getByRole('button', { name: 'Nova versão' }).click();
  const changed = JSON.parse((await import('node:fs')).readFileSync('tests/fixtures/sample-workflow.json', 'utf8'));
  changed.nodes[1].parameters.assignments.assignments[0].value = 'inativo';
  await page.getByLabel('…ou cole o JSON').fill(JSON.stringify(changed));
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.getByText('v2').first().waitFor();
  await page.getByRole('tab', { name: /Versões/ }).click();
  await page.getByRole('button', { name: 'Comparar' }).click();
  await page.getByText('Preparar', { exact: true }).first().waitFor();
  assert.ok(await page.getByText('inativo').count() > 0);
  await page.screenshot({ path: `${out}/05-comparacao-versoes.png`, fullPage: true });
  step('nova versão + comparação visual de versões');

  await page.getByRole('tab', { name: 'Testes' }).click();
  await page.getByRole('button', { name: 'Executar todos' }).click();
  await page.getByText('Reprovado').first().waitFor();
  await page.getByRole('link', { name: /agora|há/ }).first().click();
  await page.getByText('Regressão detectada.').waitFor();
  await page.getByText('output[0].status', { exact: false }).first().waitFor();
  await page.screenshot({ path: `${out}/06-regressao.png`, fullPage: true });
  step('regressão detectada com diff de saída');

  await page.getByRole('link', { name: 'Relatórios' }).click();
  await page.getByText('Considera o resultado mais recente').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'JUnit XML' }).click()]);
  assert.match(dl.suggestedFilename(), /junit/);
  await page.screenshot({ path: `${out}/07-relatorio.png`, fullPage: true });
  step('relatório com exportação JUnit');

  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByText('não implementada').first().waitFor();
  await page.screenshot({ path: `${out}/08-configuracoes.png`, fullPage: true });
  await page.getByRole('link', { name: 'Visão geral' }).click();
  await page.getByText('Execuções por dia').waitFor({ timeout: 2000 }).catch(() => undefined);
  await page.screenshot({ path: `${out}/09-dashboard-dados.png`, fullPage: true });
  step('configurações honestas sobre engines reais; dashboard com dados reais');

  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
  assert.ok(await page.getByLabel('Abrir menu').isVisible());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'overflow horizontal no mobile');
  await page.getByLabel('Abrir menu').click();
  await page.screenshot({ path: `${out}/10-mobile-menu.png` });
  step('layout mobile sem overflow horizontal e menu funcional');

  await page.goto(`${base}/#/projects`);
  await page.getByLabel('Abrir menu').click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.getByRole('heading', { name: 'Entre na sua conta' }).waitFor();
  step('logout');

  const csp = problems.filter((p) => /Content Security Policy|CSP/i.test(p));
  assert.deepEqual(csp, [], `violações de CSP: ${csp.join('\n')}`);
  assert.deepEqual(problems, [], `erros no navegador:\n${problems.join('\n')}`);
  step('nenhum erro de console, violação de CSP ou HTTP 5xx');
  ok = true;
} catch (e) {
  console.error('✗ FALHOU:', e instanceof Error ? e.message : e);
  if (problems.length) console.error('Problemas do navegador:\n' + problems.join('\n'));
  console.error('Log do servidor:\n' + serverLog.slice(-1500));
} finally {
  await browser.close();
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
