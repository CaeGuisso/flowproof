# Segurança

## Implementado e testado

| Ameaça | Medida | Verificação |
|---|---|---|
| SQL Injection | Somente consultas parametrizadas (`?`) | revisão + testes de API |
| XSS | Front sem `innerHTML`; conteúdo importado via `textContent`; CSP `script-src 'self'; style-src 'self'` | E2E sem violações de CSP |
| CSRF | Cookie `SameSite=Strict` + checagem de `Origin` + token `X-CSRF-Token` por sessão + JSON obrigatório | testes `CSRF` |
| Acesso entre usuários | Toda consulta filtra por `user_id`; 404 uniforme | teste de isolamento com ~18 rotas |
| Path traversal | Resolução + verificação de prefixo, bloqueio de `..`, `\`, `\0` | teste de estáticos |
| Upload malicioso | Só JSON via corpo, limite de tamanho (413), tipo obrigatório (415), limite de nós/profundidade | testes de importação |
| Execução de código | O conteúdo importado **nunca** é executado nem avaliado; expressões ficam como texto | testes do simulador |
| Prototype pollution | Chaves `__proto__/constructor/prototype` removidas; leitura por `hasOwn` | teste dedicado |
| Exposição de segredos | Sanitização na importação: credenciais, `pinData`, `staticData`, `meta`, `webhookId`, chaves/valores com padrão de segredo (JWT, Bearer, `sk-`, AWS, GitHub, Slack, chaves privadas, URLs com senha) e e-mails | testes de importação/export/UI |
| Força bruta | Limite por IP+e-mail (8/15 min) e por IP (40/15 min); hash scrypt; comparação em tempo constante; resposta igual para usuário inexistente | teste 429 |
| Sessão | Token aleatório de 256 bits; só o **hash** é salvo; expira em 7 dias; troca de senha encerra as outras sessões | testes |
| Cabeçalhos | CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, COOP/CORP, `Permissions-Policy`, HSTS em produção | testes + smoke em produção |
| Erros | 500 genérico com código de correlação; stack apenas no log do servidor | teste |
| Abuso de API | 900 req/min por IP; 120 execuções/min por usuário | — |

## Limitações e riscos remanescentes

- **A sanitização é heurística.** Pode haver falsos negativos (segredos sem padrão reconhecível em campos com nomes comuns). Revise antes de compartilhar exports.
- Fixtures e saídas de execução são dados do usuário e ficam no banco **sem criptografia em repouso** (proteja o disco/arquivo SQLite).
- Rate limits e sessões são **em memória/por instância**.
- Sem MFA, redefinição de senha por e-mail, papéis/organizações ou trilha de auditoria exposta na UI (a tabela `audit_log` existe e alimenta a atividade recente).
- Sem TLS próprio: use proxy HTTPS.
- SSRF/execução real: não aplicável hoje (sem requisições de saída); ver requisitos em `ENGINES.md` antes de habilitar.
- `npm audit` não foi executado (sem rede). O runtime não tem dependências de terceiros; as devDependencies não rodam em produção.
