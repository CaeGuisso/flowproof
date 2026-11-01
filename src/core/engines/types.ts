import type { EngineKind, EngineRunResult, Fixture, JsonObject } from '../types.ts';

export interface EngineRunRequest {
  workflow: JsonObject;
  fixture: Fixture;
  targetNode?: string | null;
}

export interface EngineInfo {
  id: EngineKind;
  label: string;
  description: string;
  /** true somente quando a execução é feita pelo n8n de verdade. */
  realExecution: boolean;
  implemented: boolean;
  available: boolean;
  reason?: string;
}

export interface Engine {
  info(env: Record<string, string | undefined>): EngineInfo;
  run(req: EngineRunRequest): Promise<EngineRunResult>;
}

export class EngineUnavailableError extends Error {}
