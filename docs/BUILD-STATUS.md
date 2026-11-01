# Estado da construção

Atualizado em 2026-11-01. Projeto criado do zero (não havia repositório anterior).

## Implementado
Autenticação; projetos; workflows (importação, sanitização, versões, comparação, exportação, grafo); casos de teste; engine simulada; histórico; regressão e diff; dashboard; relatórios JSON/JUnit; configurações; onboarding e exemplo removível; UI escura responsiva; documentação.

## Verificado (executado neste ambiente)
- `npm run typecheck` (tsc estrito, servidor e web): sem erros.
- `npm test`: **42 testes passando** — 14 do núcleo (paths, assertions, diff, sanitização, simulador, engines, JUnit) e 28 de API (auth, CSRF, isolamento entre usuários, CRUD, importação válida/inválida, versões, regressão, relatórios, dashboard, persistência após reinício do servidor).
- `npm run build`: gera `public/assets/*` e `dist/server.mjs`.
- `npm run test:e2e`: fluxo completo no Chromium headless contra o build (cadastro → projeto → importação → teste → execução → nova versão/comparação → regressão → relatório → configurações → mobile 390px → logout), sem erros de console/CSP/5xx.
- Smoke em `NODE_ENV=production`: cookie `Secure`, HSTS; XML JUnit validado como **bem formado** com parser Python.

## NÃO verificado / não disponível
- **Lint**: ESLint não está instalado e não havia rede; a verificação estática é o `tsc` estrito (`noUnusedLocals`, `noUncheckedIndexedAccess`, etc.).
- **`npm audit`**: sem rede. Não há dependências de runtime.
- **JUnit contra XSD**: só boa formação foi validada.
- **Navegadores**: testado apenas em Chromium (viewport desktop e 390px); Firefox/Safari e dispositivos reais não foram testados.
- **Execução real** com n8n (`real_local`/`real_container`): não implementada; nenhuma integração foi comprovada.
- Teste de carga/desempenho.

## Problemas conhecidos / limitações
- `node:sqlite` é experimental no Node 22 (emite aviso; os scripts usam `--disable-warning=ExperimentalWarning`).
- Dependências de desenvolvimento foram ligadas por symlink a pacotes já presentes no ambiente (offline); em outro ambiente use `npm install`. Não há `package-lock.json` por esse motivo.
- Simulador: só gatilhos/noOp/Set literal; demais nós exigem mock; sem nós de múltiplas saídas.
- Assertions sem curingas em listas (`items[*]`) e sem operadores de comparação numérica/contém.
- Comparação restrita a versões do mesmo workflow; sem importação por API do n8n.
- Sem recuperação de senha, MFA, papéis ou organizações.
- Gráfico diário do dashboard só aparece com execuções em ≥ 2 dias distintos (por desenho).

## Próxima tarefa exata
1. `npm install` num ambiente com rede; gerar `package-lock.json`; instalar ESLint e `npm audit`.
2. Definir o mecanismo de execução real (ver `docs/ENGINES.md`), prototipar `real_container` com n8n fixado e isolamento, com testes que provem a execução.

## Comandos
```bash
npm run check && npm run test:e2e   # validação completa
npm run build && npm start          # executar em produção local
```
