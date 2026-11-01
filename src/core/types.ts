export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const ENGINE_KINDS = ['simulated', 'real_local', 'real_container'] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

export const ASSERTION_OPS = ['exists', 'absent', 'equals', 'type', 'notEmpty'] as const;
export type AssertionOp = (typeof ASSERTION_OPS)[number];

export const JSON_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const;
export type JsonType = (typeof JSON_TYPES)[number];

export interface Assertion {
  path: string;
  op: AssertionOp;
  expected?: Json;
}

export interface AssertionResult {
  path: string;
  op: AssertionOp;
  expected?: Json;
  found: boolean;
  actual?: Json;
  passed: boolean;
  message: string;
}

export interface Fixture {
  input?: Json;
  mocks?: Record<string, Json[]>;
}

export interface DataRoot {
  input: Json[];
  output: Json[];
  nodes: Record<string, Json[]>;
}

export interface TraceEntry {
  node: string;
  type: string;
  status: 'executed' | 'mocked' | 'passthrough' | 'disabled';
  itemsOut: number;
  note?: string;
}

export interface EngineRunResult {
  status: 'completed' | 'error';
  data: DataRoot | null;
  trace: TraceEntry[];
  error?: string;
  errorNode?: string;
}

export type DiffKind = 'added' | 'removed' | 'changed';
export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: Json;
  after?: Json;
}

export interface GraphNode {
  name: string;
  type: string;
  typeVersion: number | null;
  position: [number, number];
  disabled: boolean;
  credentialTypes: string[];
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  outputIndex: number;
  inputIndex: number;
}
export interface WorkflowSummary {
  name: string;
  nodeCount: number;
  edgeCount: number;
  triggerCount: number;
  typeCounts: Record<string, number>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeChange {
  name: string;
  changes: DiffEntry[];
}
export interface WorkflowDiff {
  nodesAdded: string[];
  nodesRemoved: string[];
  nodesChanged: NodeChange[];
  nodesMoved: string[];
  edgesAdded: GraphEdge[];
  edgesRemoved: GraphEdge[];
  hasRelevantChanges: boolean;
}
