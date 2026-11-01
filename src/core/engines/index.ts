import type { EngineKind } from '../types.ts';
import { EngineUnavailableError } from './types.ts';
import type { Engine, EngineInfo } from './types.ts';
import { simulatedEngine } from './simulated.ts';

function placeholder(id: 'real_local' | 'real_container', label: string, description: string, hint: string): Engine {
  return {
    info(env): EngineInfo {
      const configured = id === 'real_local' && Boolean(env.FLOWPROOF_N8N_BIN);
      return {
        id, label, description, realExecution: true, implemented: false, available: false,
        reason: `Adapter ainda não implementado${configured ? ' (FLOWPROOF_N8N_BIN definido, mas sem efeito)' : ''}. ${hint}`,
      };
    },
    run: () => Promise.reject(new EngineUnavailableError(`A engine "${label}" não está disponível.`)),
  };
}

const registry: Record<EngineKind, Engine> = {
  simulated: simulatedEngine,
  real_local: placeholder(
    'real_local', 'Real local',
    'Executaria o workflow com um n8n instalado na máquina, em processo separado.',
    'Requer n8n local, isolamento de processo e testes de compatibilidade que não puderam ser comprovados neste ambiente.',
  ),
  real_container: placeholder(
    'real_container', 'Real em contêiner',
    'Executaria o workflow em um contêiner isolado com n8n, sem rede e com limites de recursos.',
    'Requer Docker/Podman e a imagem do n8n, indisponíveis neste ambiente; não verificado.',
  ),
};

export function getEngine(kind: EngineKind): Engine {
  return registry[kind];
}

export function listEngines(env: Record<string, string | undefined>): EngineInfo[] {
  return (Object.keys(registry) as EngineKind[]).map((k) => registry[k].info(env));
}
