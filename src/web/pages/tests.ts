import { ApiError, get, patch, post } from '../api.ts';
import { h, icon } from '../dom.ts';
import { button, card, errMsg, formField, loadInto, noteBox, pageHeader, toast } from '../ui.ts';
import { ASSERTION_OPS, JSON_TYPES } from '../../core/types.ts';
import type { AssertionOp } from '../../core/types.ts';
import type { Assertion, Execution, Json, TestCase, WorkflowDetail } from '../types.ts';
import { go } from './shared.ts';

const OP_LABEL: Record<AssertionOp, string> = {
  exists: 'existe', absent: 'está ausente', equals: 'é igual a', type: 'tem o tipo', notEmpty: 'não está vazio',
};
const SIMULATABLE = /\.(set|noOp|manualTrigger|webhook|scheduleTrigger)$|trigger$/i;

interface Row { path: HTMLInputElement; op: HTMLSelectElement; expected: HTMLInputElement; type: HTMLSelectElement; el: HTMLElement; error: HTMLElement }

function parseExpected(text: string): Json {
  try { return JSON.parse(text) as Json; } catch { return text; }
}

export function testEditorPage(root: HTMLElement, opts: { workflowId?: string; testId?: string }): void {
  const host = h('div', { class: 'stack-lg' });
  root.appendChild(host);
  void loadInto(host, async () => {
    const existing = opts.testId ? await get<TestCase>(`/api/tests/${opts.testId}`) : null;
    const workflowId = existing?.workflowId ?? (opts.workflowId as string);
    const w = await get<WorkflowDetail>(`/api/workflows/${workflowId}`);
    const nodeNames = w.summary.nodes.map((n) => n.name);
    const needMock = w.summary.nodes.filter((n) => !n.type.endsWith('.stickyNote') && !SIMULATABLE.test(n.type));

    const name = h('input', { class: 'input', type: 'text', maxlength: '150', value: existing?.name ?? '' });
    const description = h('textarea', { class: 'input', rows: '2', maxlength: '1000' }, existing?.description ?? '');
    const status = h('select', { class: 'select' }, h('option', { value: 'active' }, 'Ativo'), h('option', { value: 'disabled' }, 'Desativado'));
    status.value = existing?.status ?? 'active';
    const target = h('select', { class: 'select' }, h('option', { value: '' }, 'Automático (único nó final)'), ...nodeNames.map((n) => h('option', { value: n }, n)));
    target.value = existing?.targetNode ?? '';
    const input = h('textarea', { class: 'input mono', rows: '6', spellcheck: 'false' }, JSON.stringify(existing?.fixture.input ?? { exemplo: 'valor' }, null, 2));
    const mocks = h('textarea', { class: 'input mono', rows: '8', spellcheck: 'false' }, JSON.stringify(existing?.fixture.mocks ?? {}, null, 2));
    const fName = formField('Nome do teste', name); const fDesc = formField('Descrição (opcional)', description);
    const fStatus = formField('Estado', status); const fTarget = formField('Nó alvo (origem de "output")', target, 'Define qual nó fornece a raiz "output" para as verificações.');
    const fInput = formField('Entrada (fixture.input)', input, 'Objeto ou lista de objetos entregue ao gatilho.');
    const fMocks = formField('Mocks por nó (fixture.mocks)', mocks, 'Formato: {"Nome do nó": [{"campo": "valor"}]}. Obrigatório para nós que o simulador não executa.');
    const skeleton = button('Gerar esqueleto de mocks', { onClick: () => {
      const obj: Record<string, Json[]> = {};
      for (const n of needMock) obj[n.name] = [{}];
      mocks.value = JSON.stringify(obj, null, 2);
    } });

    const rows: Row[] = [];
    const rowsHost = h('div', { class: 'stack' });
    const datalist = h('datalist', { id: 'path-suggestions' }, ...['output[0]', 'input[0]', ...nodeNames.map((n) => `nodes["${n}"][0]`)].map((v) => h('option', { value: v })));
    const addRow = (a?: Assertion): void => {
      const path = h('input', { class: 'input mono', type: 'text', list: 'path-suggestions', placeholder: 'output[0].campo', 'aria-label': 'Caminho', maxlength: '300', value: a?.path ?? '' });
      const op = h('select', { class: 'select', 'aria-label': 'Operador' }, ...ASSERTION_OPS.map((o) => h('option', { value: o }, OP_LABEL[o])));
      op.value = a?.op ?? 'exists';
      const expected = h('input', { class: 'input mono', type: 'text', placeholder: '"texto", 10, true…', 'aria-label': 'Valor esperado', value: a?.op === 'equals' && a.expected !== undefined ? JSON.stringify(a.expected) : '' });
      const type = h('select', { class: 'select', 'aria-label': 'Tipo esperado' }, ...JSON_TYPES.map((t) => h('option', { value: t }, t)));
      if (a?.op === 'type') type.value = String(a.expected);
      const error = h('div', { class: 'field-error', role: 'alert' });
      const sync = (): void => { expected.hidden = op.value !== 'equals'; type.hidden = op.value !== 'type'; };
      op.addEventListener('change', sync); sync();
      const el = h('div', { class: 'assert-row' }, h('div', { class: 'assert-fields' }, path, op, expected, type,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remover verificação', onclick: () => { rows.splice(rows.indexOf(row), 1); el.remove(); } }, icon('trash', 16))), error);
      const row: Row = { path, op, expected, type, el, error };
      rows.push(row); rowsHost.appendChild(el);
    };
    (existing?.assertions.length ? existing.assertions : [{ path: 'output[0]', op: 'exists' as const }]).forEach(addRow);

    const general = h('div', { class: 'field-error', role: 'alert' });
    const collect = (): { body: Record<string, unknown> | null } => {
      let ok = true;
      for (const f of [fName, fDesc, fInput, fMocks, fTarget]) f.setError(undefined);
      general.textContent = '';
      if (!name.value.trim()) { fName.setError('O nome é obrigatório.'); ok = false; }
      const parse = (el: HTMLTextAreaElement, f: typeof fInput, label: string): Json | undefined => {
        if (!el.value.trim()) return undefined;
        try { return JSON.parse(el.value) as Json; } catch { f.setError(`${label}: JSON inválido.`); ok = false; return undefined; }
      };
      const inVal = parse(input, fInput, 'Entrada'); const mockVal = parse(mocks, fMocks, 'Mocks');
      const assertions: Assertion[] = [];
      for (const r of rows) {
        r.error.textContent = '';
        const path = r.path.value.trim(); const op = r.op.value as AssertionOp;
        if (!path) { r.error.textContent = 'Informe o caminho.'; ok = false; continue; }
        const a: Assertion = { path, op };
        if (op === 'equals') {
          if (r.expected.value.trim() === '') { r.error.textContent = 'Informe o valor esperado.'; ok = false; continue; }
          a.expected = parseExpected(r.expected.value);
        } else if (op === 'type') a.expected = r.type.value;
        assertions.push(a);
      }
      if (rows.length === 0) { general.textContent = 'Inclua ao menos uma verificação.'; ok = false; }
      if (!ok) return { body: null };
      const fixture: Record<string, Json> = {};
      if (inVal !== undefined) fixture.input = inVal;
      if (mockVal !== undefined) fixture.mocks = mockVal;
      return { body: { name: name.value, description: description.value, status: status.value, targetNode: target.value, fixture, assertions } };
    };
    const save = async (runAfter: boolean): Promise<void> => {
      const { body } = collect();
      if (!body) return;
      try {
        const t = existing ? await patch<TestCase>(`/api/tests/${existing.id}`, body) : await post<TestCase>(`/api/workflows/${workflowId}/tests`, body);
        toast('Teste salvo.', 'success');
        if (runAfter) {
          const e = await post<Execution>(`/api/tests/${t.id}/run`, { engine: 'simulated' });
          go(`/executions/${e.id}`);
        } else go(`/workflows/${workflowId}`);
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fields).length) {
          fName.setError(e.fields.name); fDesc.setError(e.fields.description); fInput.setError(e.fields.fixture); fTarget.setError(e.fields.targetNode);
          general.textContent = e.fields.assertions ?? e.fields.fixture ?? '';
        } else general.textContent = errMsg(e);
      }
    };
    const help = noteBox('info', h('strong', null, 'Como escrever caminhos. '), 'Use ', h('code', null, 'output[0].campo'), ' para a saída do nó alvo, ', h('code', null, 'input[0]'), ' para a entrada e ',
      h('code', null, 'nodes["Nome do nó"][0].campo'), ' para a saída de qualquer nó. Valores esperados usam JSON: ', h('code', null, '10'), ' é número e ', h('code', null, '"10"'), ' é texto.');
    return [
      pageHeader(existing ? 'Editar caso de teste' : 'Novo caso de teste', `Workflow: ${w.name} (v${w.current.version})`, null,
        h('nav', { class: 'crumbs', 'aria-label': 'Navegação' }, h('a', { href: `#/workflows/${workflowId}` }, w.name), ' / ', existing ? existing.name : 'Novo teste')),
      h('form', { class: 'stack-lg', novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
        card(h('div', { class: 'card-head' }, h('h2', null, 'Identificação')), h('div', { class: 'stack' }, fName.el, fDesc.el, h('div', { class: 'grid-2' }, fStatus.el, fTarget.el))),
        card(h('div', { class: 'card-head' }, h('h2', null, 'Dados de entrada')),
          needMock.length > 0 ? noteBox('warn', 'O simulador só executa gatilhos, noOp e Set com valores literais. Estes nós precisam de mock: ', h('strong', null, needMock.map((n) => n.name).join(', ')), '.') : null,
          h('div', { class: 'stack' }, fInput.el, fMocks.el, h('div', null, skeleton))),
        card(h('div', { class: 'card-head' }, h('h2', null, 'Verificações'), button('Adicionar verificação', { icon: 'plus', onClick: () => addRow() })), help, rowsHost, datalist),
        general,
        h('div', { class: 'row-end' }, h('a', { class: 'btn', href: `#/workflows/${workflowId}` }, 'Cancelar'), button('Salvar', { onClick: () => save(false) }), button('Salvar e executar (simulada)', { kind: 'primary', icon: 'play', onClick: () => save(true) }))),
    ];
  });
}
