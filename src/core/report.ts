export interface ReportCase {
  project: string;
  workflow: string;
  test: string;
  engine: string;
  realExecution: boolean;
  status: 'passed' | 'failed' | 'error';
  durationMs: number | null;
  message: string | null;
  startedAt: string;
}

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function toJUnit(cases: ReportCase[], generatedAt: string): string {
  const groups = new Map<string, ReportCase[]>();
  for (const c of cases) {
    const key = `${c.project} / ${c.workflow}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const secs = (ms: number | null): string => ((ms ?? 0) / 1000).toFixed(3);
  const count = (list: ReportCase[], s: string): number => list.filter((c) => c.status === s).length;
  const suites = [...groups].map(([name, list]) => {
    const body = list.map((c) => {
      const attrs = `classname="${xmlEscape(name)}" name="${xmlEscape(`${c.test} [${c.engine}]`)}" time="${secs(c.durationMs)}"`;
      const props = `<properties><property name="engine" value="${xmlEscape(c.engine)}"/><property name="real_execution" value="${c.realExecution}"/></properties>`;
      if (c.status === 'passed') return `    <testcase ${attrs}>${props}</testcase>`;
      const tag = c.status === 'failed' ? 'failure' : 'error';
      return `    <testcase ${attrs}>${props}<${tag} message="${xmlEscape(c.message ?? c.status)}"/></testcase>`;
    });
    const total = list.reduce((a, c) => a + (c.durationMs ?? 0), 0);
    return `  <testsuite name="${xmlEscape(name)}" tests="${list.length}" failures="${count(list, 'failed')}" errors="${count(list, 'error')}" skipped="0" time="${secs(total)}" timestamp="${xmlEscape(generatedAt)}">\n${body.join('\n')}\n  </testsuite>`;
  });
  const totalMs = cases.reduce((a, c) => a + (c.durationMs ?? 0), 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="FlowProof" tests="${cases.length}" failures="${count(cases, 'failed')}" errors="${count(cases, 'error')}" time="${secs(totalMs)}">\n${suites.join('\n')}\n</testsuites>\n`;
}
