# Arquitetura

```
src/core/      Lógica pura (sem I/O, sem Node): paths, assertions, diff, importação/sanitização,
               engines, runner, JUnit. Reutilizada pelo servidor e pelo front-end (tipos).
src/server/    Node http + node:sqlite: config, migrations, db, auth, segurança, router, store, rotas.
src/web/       SPA em TypeScript puro (hash router), empacotada com esbuild; CSS próprio.
tests/         node:test — núcleo e API (servidor real em porta efêmera, SQLite em arquivo temporário).
scripts/       build.mjs (esbuild) e e2e.mjs (Playwright).
```

## Decisões

| Decisão | Motivo |
|---|---|
| **Sem framework/ORM** (http nativo, `node:sqlite`, SPA sem React) | O ambiente de construção não tinha rede; zero dependências de runtime reduz superfície de ataque e atrito. O front usa um helper `h()` que nunca usa `innerHTML` (XSS por construção). |
| **SQLite** com migrations numeradas (`schema_migrations`) | Persistência real, sem serviço externo. Camada `Db` pequena (`get/all/run/tx`) isola o acesso para uma futura troca por PostgreSQL. |
| **Núcleo puro em `src/core`** | Testável sem servidor; separa regra de negócio de transporte. |
| **Engines como adapters** (`Engine { info(), run() }`) | Execução real entra sem mudar API/UI; hoje só a simulada está ativa. |
| **Hash router (`#/...`)** | Evita colisão com rotas `/api` e dispensa configuração de fallback no proxy (o servidor ainda atende SPA fallback). |
| **CSP estrita** (`script-src 'self'; style-src 'self'`) | Sem scripts/estilos inline: o front usa CSSOM em vez de `style=""`. |
| **Isolamento por `user_id`** em toda consulta | Recursos de outros usuários respondem **404** (não revelam existência). |
| **Nomes de teste/workflow em snapshot** nas execuções | O histórico continua legível se o teste for removido (`test_case_id` vira `NULL`). |

## Modelo de dados (migration 1)

`users` · `sessions` (hash do token + CSRF) · `projects` · `workflows` · `workflow_versions` (conteúdo **sanitizado**, hash, contagem de redações) · `test_cases` (fixture e assertions em JSON) · `executions` (engine, `real_execution`, status, duração, resultado, saída, diff, baseline, regressão) · `audit_log`.
Chaves estrangeiras com `ON DELETE CASCADE` (projeto → workflows → versões/testes/execuções).

## Regressão e diff

Ao executar, busca-se a execução anterior **do mesmo teste e da mesma engine** com saída registrada. O diff (`diffJson`) compara as saídas; `regression = anterior passou && atual não passou`. Comparação de versões usa `diffWorkflows` (nós adicionados/removidos/alterados, conexões; posição isolada não é mudança relevante).

## Evolução para SaaS

- Trocar `Db` por PostgreSQL (SQL é padrão, com `?` → `$n`); mover migrations para ferramenta dedicada.
- Introduzir organizações/papéis (hoje a posse é por usuário).
- Fila + workers para engines reais; rate limit e sessões em Redis.
- Autenticação externa (OIDC) e redefinição de senha por e-mail (não implementados).
