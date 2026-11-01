# Engines de execução

| Engine | Execução real? | Estado |
|---|---|---|
| `simulated` | **Não** | Implementada e disponível |
| `real_local` | Sim (planejada) | **Não implementada**, desabilitada |
| `real_container` | Sim (planejada) | **Não implementada**, desabilitada |

A UI, o histórico (`executions.real_execution`) e os relatórios distinguem as engines. Chamar uma engine indisponível retorna **409** e **não grava** execução.

## Engine simulada

Percorre o grafo (conexões `main`) em ordem topológica a partir da entrada da fixture. Executa **apenas**:

- gatilhos (`*Trigger`, `webhook`) e o primeiro `noOp`: recebem `fixture.input`;
- `noOp` intermediário e nós desabilitados: repassam os dados;
- `Set` (v1/v2 `values` e v3 `assignments`) com **valores literais** (string, number, boolean, object/array em JSON; nomes com `.` criam objetos aninhados).

Qualquer outro nó exige um **mock** em `fixture.mocks["Nome do nó"] = [ {…} ]`; sem mock a execução termina em `error` com mensagem clara. Expressões (`={{ … }}`) **nunca são avaliadas**. Ciclos, múltiplos nós finais sem `targetNode` e nós alvo inexistentes são erros explícitos. Nós `if`/`switch`/`merge` com várias saídas não são simulados (use mock).

Raiz dos dados para assertions: `{ input: [...], output: [...], nodes: { "Nome": [...] } }`.

## Por que não há execução real ainda

Não foi possível, neste ambiente (sem rede, sem Docker, sem n8n instalado), **comprovar** nenhuma integração, e a regra do projeto é não falsificar. Antes de implementar:

1. Escolher o mecanismo oficial (CLI `n8n execute --id` / API pública / contêiner) e fixar uma versão compatível do n8n.
2. Rever licenciamento (a *Sustainable Use License* do n8n restringe uso comercial/redistribuição; validar o enquadramento do FlowProof).
3. **Isolamento obrigatório**: processo/contêiner separado, sem rede (ou com allowlist anti-SSRF), usuário sem privilégios, limites de CPU/memória/tempo, sistema de arquivos somente leitura, sem credenciais reais.
4. Nunca executar workflows arbitrários no processo do FlowProof.

## Como implementar um adapter

Implemente `Engine` (`src/core/engines/types.ts`), retorne `EngineRunResult` com `data` no mesmo formato (`input/output/nodes`), registre em `src/core/engines/index.ts` com `implemented: true` e `available` refletindo uma sondagem real (binário/daemon presente). Adicione testes que provem a execução real antes de marcar `realExecution`.
