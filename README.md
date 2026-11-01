# FlowProof

Plataforma de qualidade e testes para automações criadas no **n8n**. Organize projetos e workflows, importe JSON exportado do n8n, crie casos de teste com assertions, execute, acompanhe o histórico, compare versões, detecte regressões e exporte relatórios (JSON e JUnit XML).

> **Honestidade sobre execução:** hoje só existe a engine **simulada**, que percorre o grafo com dados de uma fixture e mocks. Ela **não executa o n8n** e é sempre rotulada como simulada na interface, no histórico e nos relatórios. As engines `real_local` e `real_container` existem como adapters **desabilitados** (ver [docs/ENGINES.md](docs/ENGINES.md)).

## Funcionalidades disponíveis

- **Conta e sessão**: cadastro, login, logout, troca de senha (scrypt, cookie HttpOnly/SameSite=Strict, CSRF).
- **Projetos**: criar, editar, excluir (com confirmação por nome), estatísticas e atividade.
- **Workflows**: importar JSON do n8n (validação + sanitização), grafo SVG com detalhes dos nós, versões, comparação entre versões, exportação (versão sanitizada), exclusão segura.
- **Casos de teste**: fixture (entrada + mocks por nó), assertions `exists`, `absent`, `equals`, `type`, `notEmpty`; criar, editar, duplicar, desativar, excluir.
- **Execução**: engine simulada; histórico persistente; detalhe com assertions, trilha por nó, saída e diff contra a execução anterior; marcação de **regressão** (passou → falhou).
- **Dashboard** e **relatórios** com dados reais do banco (sem números inventados), exportação JSON e JUnit XML.
- **Onboarding**: estados vazios, checklist de 5 passos e workflow de exemplo removível.
- Interface escura, responsiva (desktop, tablet, celular).

## Requisitos

- Node.js **22.13+** (usa `node:sqlite` e execução nativa de TypeScript). Nenhuma dependência de runtime.
- Para desenvolvimento: `typescript`, `esbuild` e `@types/node`; para E2E: `playwright` + Chromium.

## Instalação e execução

```bash
npm install            # instala as devDependencies (typescript, esbuild, @types/node, playwright)
cp .env.example .env   # ajuste se necessário (o app lê variáveis de ambiente do processo)
npm run build          # gera public/assets/ e dist/server.mjs
npm start              # http://127.0.0.1:3000
```

Desenvolvimento (recarrega o servidor; o front precisa de `npm run build` após mudanças):

```bash
npm run dev
```

> O `.env.example` documenta as variáveis; o servidor **não** carrega arquivos `.env` sozinho. Exporte as variáveis no shell, no systemd, no Docker ou use `node --env-file=.env dist/server.mjs`.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `NODE_ENV` | — | `production` ativa cookie `Secure` e HSTS |
| `FLOWPROOF_DB_PATH` | `./data/flowproof.db` | Arquivo SQLite (criado e migrado automaticamente) |
| `FLOWPROOF_ALLOW_REGISTRATION` | `true` | Permite novos cadastros |
| `FLOWPROOF_COOKIE_SECURE` | `true` em produção | Força a flag `Secure` do cookie |
| `FLOWPROOF_TRUST_PROXY` | `false` | Usa `X-Forwarded-For` para o IP (só atrás de proxy confiável) |
| `FLOWPROOF_MAX_BODY_BYTES` | `2097152` | Limite de corpo/upload JSON |
| `FLOWPROOF_PUBLIC_DIR` | `./public` | Diretório dos arquivos estáticos |
| `FLOWPROOF_N8N_BIN` | — | Informativo; a execução real ainda não usa |

## Testes e verificações

```bash
npm run typecheck   # tsc estrito: servidor/núcleo e front-end
npm test            # 42 testes (núcleo + API de ponta a ponta com SQLite real)
npm run build       # bundle de produção
npm run test:e2e    # fluxo completo no Chromium contra dist/ (gera capturas em test-results/)
npm run check       # typecheck + test + build
```

## Como usar

1. **Crie um projeto** em *Projetos → Novo projeto*.
2. **Importe um workflow**: no n8n, exporte o workflow (JSON) e envie o arquivo (ou cole o JSON). Segredos são removidos antes de salvar.
3. **Crie um caso de teste** na aba *Testes*: informe a entrada (`fixture.input`), mocks para nós que o simulador não executa e as verificações. Caminhos: `output[0].campo` (saída do nó alvo), `input[0]`, `nodes["Nome do nó"][0].campo`. Valores esperados são JSON (`10` é número, `"10"` é texto).
4. **Execute** (um teste ou todos) e **consulte** o resultado em *Execuções*.
5. Importe **novas versões** do workflow, compare-as e reexecute para detectar regressões.
6. Exporte em *Relatórios* (JSON ou JUnit XML para CI).

## Preparar para produção

- Use `NODE_ENV=production`, sirva atrás de um proxy HTTPS (o app não termina TLS) e defina `FLOWPROOF_TRUST_PROXY=true` apenas se o proxy sobrescrever `X-Forwarded-For`.
- Após criar as contas necessárias, defina `FLOWPROOF_ALLOW_REGISTRATION=false`.
- Faça backup do arquivo SQLite (e de `-wal`/`-shm`) com o app parado ou via `sqlite3 .backup`.
- Para escalar além de uma instância: o rate limit é em memória e o banco é SQLite; migre a camada `src/server/db.ts` para PostgreSQL e use um limitador compartilhado (ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Limitações conhecidas

Veja [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md) para o estado completo (o que foi testado, o que não foi, pendências).

## Documentação

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitetura e decisões
- [docs/ENGINES.md](docs/ENGINES.md) — engines e como estender para execução real
- [docs/SECURITY.md](docs/SECURITY.md) — modelo de segurança
- [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md) — estado da construção
