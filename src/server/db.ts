import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

export type Row = Record<string, unknown>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const done = new Set((this.raw.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.raw.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, new Date().toISOString());
      });
    }
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.raw.prepare(sql).run(...params).changes);
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }
}
