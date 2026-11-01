import { ApiError, post, setCsrf } from '../api.ts';
import { clear, h, logoMark } from '../dom.ts';
import { button, errMsg, formField } from '../ui.ts';
import type { Session } from '../types.ts';
import { state } from './shared.ts';

export function renderAuth(root: HTMLElement, onDone: () => void): void {
  clear(root);
  let mode: 'login' | 'register' = 'login';
  const panel = h('div', { class: 'auth-card' });

  const draw = (): void => {
    clear(panel);
    const register = mode === 'register';
    const name = h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: '100' });
    const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', maxlength: '254', required: true });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: register ? 'new-password' : 'current-password', maxlength: '200', required: true });
    const fName = formField('Nome', name);
    const fEmail = formField('E-mail', email);
    const fPass = formField('Senha', pass, register ? 'Mínimo de 10 caracteres.' : undefined);
    const general = h('div', { class: 'field-error', role: 'alert' });
    const submit = button(register ? 'Criar conta' : 'Entrar', { kind: 'primary', type: 'submit' });
    const form = h('form', { class: 'stack', novalidate: true }, register ? fName.el : null, fEmail.el, fPass.el, general, submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      for (const f of [fName, fEmail, fPass]) f.setError(undefined);
      general.textContent = '';
      submit.disabled = true;
      const body = register ? { name: name.value, email: email.value, password: pass.value } : { email: email.value, password: pass.value };
      post<Session>(register ? '/api/auth/register' : '/api/auth/login', body)
        .then((s) => { state.user = s.user; setCsrf(s.csrf); onDone(); })
        .catch((e: unknown) => {
          if (e instanceof ApiError && Object.keys(e.fields).length > 0) {
            fName.setError(e.fields.name); fEmail.setError(e.fields.email); fPass.setError(e.fields.password);
          } else general.textContent = errMsg(e);
        })
        .finally(() => { submit.disabled = false; });
    });
    panel.append(
      h('div', { class: 'brand brand-lg' }, logoMark(32), h('span', null, 'FlowProof')),
      h('h1', null, register ? 'Crie sua conta' : 'Entre na sua conta'),
      h('p', { class: 'muted' }, 'Testes, histórico e controle de qualidade para suas automações n8n.'),
      form,
      state.registrationOpen
        ? h('p', { class: 'muted center' }, register ? 'Já tem conta? ' : 'Ainda não tem conta? ',
          h('button', { class: 'link', type: 'button', onclick: () => { mode = register ? 'login' : 'register'; draw(); } }, register ? 'Entrar' : 'Criar conta'))
        : h('p', { class: 'muted center' }, 'O cadastro está desativado neste ambiente.'),
    );
    (register ? name : email).focus();
  };
  draw();
  root.appendChild(h('main', { class: 'auth' }, panel));
}
