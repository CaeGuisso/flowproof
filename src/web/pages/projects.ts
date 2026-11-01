import { ApiError, del, get, patch, post } from '../api.ts';
import { fmtAgo, fmtDate, fmtMs, h, icon } from '../dom.ts';
import {
  badge, button, card, emptyState, engineBadge, errMsg, formField, loadInto, noteBox, openModal, pageHeader, statusBadge, table, toast, typedConfirm,
} from '../ui.ts';
import type { ModalHandle } from '../ui.ts';
import type { Execution, Json, Project, WorkflowDetail, WorkflowListItem } from '../types.ts';
import { getEngines, go, plural } from './shared.ts';

const MAX_UPLOAD = 2 * 1024 * 1024;

export function projectModal(existing: Project | null, onSaved: (p: Project) => void): void {
  const name = h('input', { class: 'input', type: 'text', maxlength: '100', value: existing?.name ?? '', required: true });
  const client = h('input', { class: 'input', type: 'text', maxlength: '100', value: existing?.client ?? '' });
  const description = h('textarea', { class: 'input', rows: '3', maxlength: '1000' }, existing?.description ?? '');
  const fName = formField('Nome do projeto', name); const fClient = formField('Cliente (opcional)', client); const fDesc = formField('Descrição (opcional)', description);
  const general = h('div', { class: 'field-error', role: 'alert' });
  let modal: ModalHandle;
  const save = button(existing ? 'Salvar alterações' : 'Criar projeto', {
    kind: 'primary', type: 'submit',
    onClick: async () => {
      [fName, fClient, fDesc].forEach((f) => f.setError(undefined)); general.textContent = '';
      const body = { name: name.value, client: client.value, description: description.value };
      try {
        const p = existing ? await patch<Project>(`/api/projects/${existing.id}`, body) : await post<Project>('/api/projects', body);
        modal.close(); toast(existing ? 'Projeto atualizado.' : 'Projeto criado.', 'success'); onSaved(p);
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fields).length) { fName.setError(e.fields.name); fClient.setError(e.fields.client); fDesc.setError(e.fields.description); } else general.textContent = errMsg(e);
      }
    },
  });
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e: Event) => e.preventDefault() }, fName.el, fClient.el, fDesc.el, general);
  modal = openModal(existing ? 'Editar projeto' : 'Novo projeto', form, { footer: h('div', { class: 'row-end' }, button('Cancelar', { onClick: () => modal.close() }), save) });
}

export function importModal(title: string, intro: string, onSubmit: (workflow: Json, name: string) => Promise<void>, withName = true): void {
  const file = h('input', { class: 'input', type: 'file', accept: '.json,application/json' });
  const paste = h('textarea', { class: 'input mono', rows: '6', placeholder: '{ "name": "...", "nodes": [...], "connections": {...} }', spellcheck: 'false' });
  const name = h('input', { class: 'input', type: 'text', maxlength: '150', placeholder: 'Usar o nome do arquivo' });
  const fFile = formField('Arquivo JSON exportado do n8n', file, 'Até 2 MB.'); const fPaste = formField('…ou cole o JSON', paste); const fName = formField('Nome (opcional)', name);
  const general = h('div', { class: 'field-error', role: 'alert' });
  let modal: ModalHandle;
  const submit = button('Importar', {
    kind: 'primary', icon: 'upload',
    onClick: async () => {
      general.textContent = ''; fFile.setError(undefined); fPaste.setError(undefined);
      let text = paste.value.trim();
      const f = file.files?.[0];
      if (f) {
        if (f.size > MAX_UPLOAD) return void fFile.setError('Arquivo maior que 2 MB.');
        text = await f.text();
      }
      if (!text) return void fFile.setError('Selecione um arquivo ou cole o JSON.');
      let parsed: Json;
      try { parsed = JSON.parse(text) as Json; } catch { return void (f ? fFile : fPaste).setError('O conteúdo não é um JSON válido.'); }
      try { await onSubmit(parsed, name.value); modal.close(); } catch (e) {
        general.textContent = e instanceof ApiError && e.fields.workflow ? `${e.message} ${e.fields.workflow}` : errMsg(e);
      }
    },
  });
  modal = openModal(title, h('div', { class: 'stack' },
    noteBox('info', intro),
    fFile.el, fPaste.el, withName ? fName.el : null, general), { wide: true, footer: h('div', { class: 'row-end' }, button('Cancelar', { onClick: () => modal.close() }), submit) });
}

export function projectsPage(root: HTMLElement): void {
  const body = h('div');
  const reload = (): void => void loadInto(body, async () => {
    const list = await get<Project[]>('/api/projects');
    if (list.length === 0) {
      return emptyState({ icon: 'folder', title: 'Crie seu primeiro projeto', text: 'Projetos organizam os workflows e testes de cada cliente ou produto.', action: button('Novo projeto', { kind: 'primary', icon: 'plus', onClick: () => projectModal(null, (p) => go(`/projects/${p.id}`)) }) });
    }
    return h('div', { class: 'cards' }, ...list.map((p) => h('a', { class: 'project-card', href: `#/projects/${p.id}` },
      h('div', { class: 'row-between' }, h('h3', null, p.name), p.stats.quality === null ? badge('Sem testes executados', 'muted') : badge(`${p.stats.quality}% aprovados`, p.stats.quality === 100 ? 'ok' : 'warn')),
      h('p', { class: 'muted clamp' }, p.client ? `Cliente: ${p.client}${p.description ? ` — ${p.description}` : ''}` : p.description || 'Sem descrição.'),
      h('div', { class: 'meta' }, h('span', null, plural(p.stats.workflows, 'workflow', 'workflows')), h('span', null, plural(p.stats.tests, 'teste', 'testes')), h('span', null, `Atividade ${fmtAgo(p.stats.lastActivity)}`)))));
  });
  root.append(pageHeader('Projetos', 'Organize workflows e testes por cliente ou produto.', button('Novo projeto', { kind: 'primary', icon: 'plus', onClick: () => projectModal(null, (p) => go(`/projects/${p.id}`)) })), body);
  reload();
}

export function projectDetailPage(root: HTMLElement, id: string): void {
  const host = h('div', { class: 'stack-lg' });
  root.appendChild(host);
  const reload = (): void => void loadInto(host, async () => {
    const [p, wfs, recent] = await Promise.all([
      get<Project>(`/api/projects/${id}`), get<WorkflowListItem[]>(`/api/projects/${id}/workflows`),
      get<{ items: Execution[] }>(`/api/executions?projectId=${id}&limit=8`),
    ]);
    const engines = await getEngines();
    const sim = engines.find((e) => e.id === 'simulated');
    const doImport = (): void => importModal('Importar workflow', 'O workflow é validado e sanitizado antes de ser salvo: credenciais, tokens, chaves de API, pinData e e-mails são removidos ou mascarados. Nada do conteúdo é executado.',
      async (workflow, name) => { const w = await post<WorkflowDetail>(`/api/projects/${id}/workflows`, { workflow, name }); toast('Workflow importado.', 'success'); go(`/workflows/${w.id}`); });
    const actions = h('div', { class: 'row-gap wrap' },
      button('Importar workflow', { kind: 'primary', icon: 'upload', onClick: doImport }),
      h('a', { class: 'btn', href: `#/reports/${id}` }, icon('report', 16), 'Relatório'),
      button('Editar', { icon: 'edit', onClick: () => projectModal(p, reload) }),
      button('Excluir', { kind: 'danger', icon: 'trash', onClick: async () => {
        const typed = await typedConfirm({ title: 'Excluir projeto', message: 'Todos os workflows, testes e o histórico de execuções deste projeto serão removidos permanentemente.', name: p.name, confirmLabel: 'Excluir projeto' });
        if (typed === null) return;
        try { await del(`/api/projects/${id}`, { confirmName: typed }); toast('Projeto excluído.', 'success'); go('/projects'); } catch (e) { toast(errMsg(e), 'error'); }
      } }));
    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Navegação' }, h('a', { href: '#/projects' }, 'Projetos'), ' / ', p.name);
    const stat = (l: string, v: string): HTMLElement => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, l), h('span', { class: 'stat-value' }, v));
    const wfBlock = wfs.length === 0
      ? emptyState({ icon: 'flow', title: 'Nenhum workflow ainda', text: 'Importe um JSON exportado do n8n ou comece com um exemplo para conhecer o fluxo.', action: h('div', { class: 'row-gap' }, button('Importar workflow', { kind: 'primary', icon: 'upload', onClick: doImport }),
        button('Adicionar exemplo', { onClick: async () => { try { const w = await post<WorkflowDetail>(`/api/projects/${id}/example`); toast('Exemplo adicionado. Você pode removê-lo quando quiser.', 'success'); go(`/workflows/${w.id}`); } catch (e) { toast(errMsg(e), 'error'); } } })) })
      : table(['Workflow', 'Versão', 'Nós', 'Testes', 'Último resultado', ''], wfs.map((w) => [
        h('span', { class: 'row-gap' }, h('a', { href: `#/workflows/${w.id}` }, w.name), w.isExample ? badge('exemplo', 'info') : null), `v${w.version}`, String(w.nodeCount), String(w.tests),
        h('span', { class: 'row-gap' }, statusBadge(w.lastStatus), w.lastRunAt ? h('span', { class: 'muted small' }, fmtAgo(w.lastRunAt)) : null),
        w.tests > 0 && sim?.available ? button('Executar testes', { icon: 'play', title: 'Engine simulada', onClick: async () => {
          try { const r = await post<Execution[]>(`/api/workflows/${w.id}/run`, { engine: 'simulated' }); const ok = r.filter((e) => e.status === 'passed').length; toast(`${ok}/${r.length} testes aprovados (simulação).`, ok === r.length ? 'success' : 'error'); reload(); } catch (e) { toast(errMsg(e), 'error'); }
        } }) : null]));
    return [
      pageHeader(p.name, p.client ? `Cliente: ${p.client}${p.description ? ` · ${p.description}` : ''}` : p.description || `Criado em ${fmtDate(p.createdAt)}`, actions, crumbs),
      h('div', { class: 'stats' }, stat('Workflows', String(p.stats.workflows)), stat('Casos de teste', String(p.stats.tests)), stat('Execuções', String(p.stats.executions)),
        stat('Qualidade atual', p.stats.quality === null ? '—' : `${p.stats.quality}%`), stat('Última atividade', fmtAgo(p.stats.lastActivity))),
      card(h('div', { class: 'card-head' }, h('h2', null, 'Workflows')), wfBlock),
      card(h('div', { class: 'card-head' }, h('h2', null, 'Execuções recentes'), h('a', { href: `#/executions?projectId=${id}` }, 'Ver histórico')),
        recent.items.length === 0 ? h('p', { class: 'muted' }, 'Nenhuma execução neste projeto ainda.')
          : table(['Teste', 'Workflow', 'Engine', 'Status', 'Duração', 'Quando'], recent.items.map((e) => [h('a', { href: `#/executions/${e.id}` }, e.testName), e.workflowName, engineBadge(e.engine), statusBadge(e.status), fmtMs(e.durationMs), fmtAgo(e.startedAt)]))),
    ];
  });
  reload();
}
