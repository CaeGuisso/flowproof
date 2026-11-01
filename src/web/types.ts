import type { Assertion, AssertionResult, DiffEntry, EngineKind, Fixture, GraphEdge, GraphNode, Json, TraceEntry, WorkflowDiff, WorkflowSummary } from '../core/types.ts';

export type { Assertion, AssertionResult, DiffEntry, EngineKind, Fixture, GraphEdge, GraphNode, Json, TraceEntry, WorkflowDiff, WorkflowSummary };
export type ExecStatus = 'passed' | 'failed' | 'error';

export interface User { id: string; email: string; name: string }
export interface Session { user: User | null; csrf: string | null; registrationOpen: boolean }
export interface ProjectStats { workflows: number; tests: number; executions: number; lastActivity: string; testsWithResult: number; testsPassing: number; quality: number | null }
export interface Project { id: string; name: string; client: string; description: string; createdAt: string; updatedAt: string; stats: ProjectStats }
export interface WorkflowListItem { id: string; projectId: string; name: string; isExample: boolean; version: number; nodeCount: number; tests: number; lastStatus: ExecStatus | null; lastRunAt: string | null; updatedAt: string }
export interface VersionMeta { id: string; version: number; nodeCount: number; redactionCount: number; warnings: string[]; contentHash: string; createdAt: string }
export interface WorkflowDetail { id: string; projectId: string; projectName: string; name: string; isExample: boolean; createdAt: string; updatedAt: string; current: VersionMeta; summary: WorkflowSummary; versions: VersionMeta[] }
export interface TestCase {
  id: string; workflowId: string; name: string; description: string; fixture: Fixture; assertions: Assertion[]; targetNode: string | null;
  status: 'active' | 'disabled'; createdAt: string; updatedAt: string; lastExecution: { id: string; status: ExecStatus; engine: EngineKind; startedAt: string } | null;
}
export interface Execution {
  id: string; projectId: string; projectName: string; workflowId: string; workflowName: string; workflowVersion: number | null; testCaseId: string | null; testName: string;
  engine: EngineKind; realExecution: boolean; status: ExecStatus; startedAt: string; durationMs: number | null; assertionsPassed: number; assertionsFailed: number;
  error: string | null; regression: boolean; baselineExecutionId: string | null;
}
export interface ExecutionDetail extends Execution { assertions: AssertionResult[]; trace: TraceEntry[]; errorNode: string | null; output: Json | null; diff: DiffEntry[] }
export interface EngineInfo { id: EngineKind; label: string; description: string; realExecution: boolean; implemented: boolean; available: boolean; reason?: string }
export interface Dashboard {
  totals: { projects: number; workflows: number; tests: number; executions: number; passed: number; failed: number; errors: number };
  passRate: number | null; byEngine: Record<string, number>; daily: { day: string; passed: number; failed: number }[]; recent: Execution[];
  activity: { action: string; entity: string; entityId: string | null; label: string | null; createdAt: string }[];
  projectOverview: { id: string; name: string; client: string; quality: number | null; tests: number; workflows: number }[];
}
export interface Report {
  generatedAt: string; notice: string; project: { id: string; name: string; client: string };
  summary: { total: number; passed: number; failed: number; errors: number; regressions: number; realExecutions: number; simulatedExecutions: number };
  results: Execution[]; history: Execution[];
}
export interface Settings {
  user: { email: string; name: string; createdAt: string; activeSessions: number };
  environment: { node: string; mode: string; database: string; registrationOpen: boolean; maxUploadBytes: number };
  engines: EngineInfo[]; integrations: { id: string; label: string; status: string; detail: string }[];
}
