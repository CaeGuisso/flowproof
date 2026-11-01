import type { Assertion, Fixture, JsonObject } from '../core/types.ts';

export const EXAMPLE_WORKFLOW: JsonObject = {
  name: 'Exemplo: boas-vindas ao cliente',
  active: false,
  nodes: [
    { id: 'e1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 120], parameters: { path: 'boas-vindas', httpMethod: 'POST' } },
    {
      id: 'e2', name: 'Preparar dados', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [260, 120],
      parameters: {
        assignments: { assignments: [
          { id: 'a1', name: 'status', value: 'ativo', type: 'string' },
          { id: 'a2', name: 'creditos', value: '10', type: 'number' },
        ] },
        includeOtherFields: true,
      },
    },
    { id: 'e3', name: 'Notificar equipe', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [520, 120], parameters: { url: 'https://example.com/notificar', method: 'POST' } },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Preparar dados', type: 'main', index: 0 }]] },
    'Preparar dados': { main: [[{ node: 'Notificar equipe', type: 'main', index: 0 }]] },
  },
};

export interface ExampleTest { name: string; description: string; fixture: Fixture; assertions: Assertion[]; targetNode: string | null }

export const EXAMPLE_TESTS: ExampleTest[] = [
  {
    name: 'Cliente novo recebe status ativo',
    description: 'Exemplo: valida os campos criados pelo nó Set. O nó HTTP é substituído por um mock.',
    fixture: { input: { nome: 'Ana', plano: 'pro' }, mocks: { 'Notificar equipe': [{ enviado: true }] } },
    assertions: [
      { path: 'nodes["Preparar dados"][0].status', op: 'equals', expected: 'ativo' },
      { path: 'nodes["Preparar dados"][0].creditos', op: 'type', expected: 'number' },
      { path: 'nodes["Preparar dados"][0].nome', op: 'notEmpty' },
      { path: 'output[0].enviado', op: 'equals', expected: true },
    ],
    targetNode: null,
  },
  {
    name: 'Não vaza campos internos',
    description: 'Exemplo: garante que nenhum campo "senha" chega ao final do fluxo.',
    fixture: { input: { nome: 'Bruno' }, mocks: { 'Notificar equipe': [{ enviado: true }] } },
    assertions: [{ path: 'output[0].senha', op: 'absent' }],
    targetNode: null,
  },
];
