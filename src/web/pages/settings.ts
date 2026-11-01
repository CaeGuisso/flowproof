import { ApiError, get, patch, post } from '../api.ts';
import { fmtDate, h } from '../dom.ts';
import { badge, button, card, errMsg, formField, loadInto, noteBox, pageHeader, toast } from '../ui.ts';
import type { Settings } from '../types.ts';
import { state } from './shared.ts';

export function settingsPage(root: HTMLElement): void {
  const host = h('div', { class: 'stack-lg' });
  root.append(pageHeader('Configurações', 'Conta, ambiente, engines e integrações.'), host);
  void loadInto(host, async () => {
    const s = await get<Settings>('/api/settings');
    const name = h('input', { class: 'input', type: 'text', maxlength: '100', value: s.user.name });
    const fName = formField('Nome', name);
    const profile = card(h('div', { class: 'card-head' }, h('h2', null, 'Conta')),
      h('form', { class: 'stack', novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
        h('p', { class: 'muted' }, `${s.user.email} · conta criada em ${fmtDate(s.user.createdAt)} · ${s.user.activeSessions} sessão(ões) ativa(s)`), fName.el,
        h('div', null, button('Salvar nome', { onClick: async () => {
          fName.setError(undefined);
          try { const r = await patch<{ name: string }>('/api/auth/profile', { name: name.value }); if (state.user) state.user.name = r.name; toast('Nome atualizado.', 'success'); } catch (e) { fName.setError(e instanceof ApiError ? e.fields.name ?? e.message : errMsg(e)); }
        } }))));
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', maxlength: '200' });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', maxlength: '200' });
    const fCur = formField('Senha atual', cur); const fNext = formField('Nova senha', next, 'Mínimo de 10 caracteres. Outras sessões serão encerradas.');
    const password = card(h('div', { class: 'card-head' }, h('h2', null, 'Alterar senha')), h('form', { class: 'stack', novalidate: true, onsubmit: (e: Event) => e.preventDefault() }, fCur.el, fNext.el,
      h('div', null, button('Alterar senha', { onClick: async () => {
        fCur.setError(undefined); fNext.setError(undefined);
        try { await post('/api/auth/password', { currentPassword: cur.value, newPassword: next.value }); cur.value = ''; next.value = ''; toast('Senha alterada.', 'success'); } catch (e) {
          if (e instanceof ApiError && Object.keys(e.fields).length) { fCur.setError(e.fields.currentPassword); fNext.setError(e.fields.newPassword); } else toast(errMsg(e), 'error');
        }
      } }))));
    const kv = (k: string, v: string): HTMLElement => h('div', { class: 'meta-item' }, h('span', { class: 'muted small' }, k), h('div', null, v));
    const env = card(h('div', { class: 'card-head' }, h('h2', null, 'Ambiente')), h('div', { class: 'meta-grid' },
      kv('Modo', s.environment.mode), kv('Node.js', s.environment.node), kv('Banco de dados', s.environment.database), kv('Cadastro de novos usuários', s.environment.registrationOpen ? 'Aberto' : 'Fechado'),
      kv('Tamanho máximo de upload', `${Math.round(s.environment.maxUploadBytes / 1024 / 1024 * 10) / 10} MB`)));
    const engines = card(h('div', { class: 'card-head' }, h('h2', null, 'Engines de execução')),
      h('div', { class: 'stack' }, ...s.engines.map((e) => h('div', { class: 'engine-row' },
        h('div', null, h('strong', null, e.label), h('p', { class: 'muted' }, e.description), e.reason ? h('p', { class: 'small warn-text' }, e.reason) : null),
        e.available ? badge('disponível', 'ok') : badge(e.implemented ? 'indisponível' : 'não implementada', 'muted')))));
    const integrations = card(h('div', { class: 'card-head' }, h('h2', null, 'Integrações')),
      h('div', { class: 'stack' }, ...s.integrations.map((i) => h('div', { class: 'engine-row' }, h('div', null, h('strong', null, i.label), h('p', { class: 'muted' }, i.detail)), badge('não conectada', 'muted')))));
    return [noteBox('info', 'Execução real com o n8n ainda não está disponível. A engine simulada nunca é apresentada como real.'), profile, password, env, engines, integrations];
  });
}
