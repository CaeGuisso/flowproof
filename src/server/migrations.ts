export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'schema-inicial',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_example INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workflows_project ON workflows(project_id);
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  redaction_count INTEGER NOT NULL,
  warnings TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workflow_id, version)
);
CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fixture TEXT NOT NULL,
  assertions TEXT NOT NULL,
  target_node TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tests_workflow ON test_cases(workflow_id);
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  test_name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('simulated', 'real_local', 'real_container')),
  real_execution INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'error')),
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  assertions_passed INTEGER NOT NULL DEFAULT 0,
  assertions_failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  result TEXT NOT NULL,
  output TEXT,
  diff TEXT NOT NULL DEFAULT '[]',
  baseline_execution_id TEXT,
  regression INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_exec_user_started ON executions(user_id, started_at DESC);
CREATE INDEX idx_exec_project ON executions(project_id);
CREATE INDEX idx_exec_test ON executions(test_case_id, engine, started_at DESC);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id, id DESC);
`,
  },
];
