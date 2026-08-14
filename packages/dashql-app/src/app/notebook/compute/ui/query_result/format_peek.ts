export type FormatHint = 'json' | 'sql' | 'plan' | null;

const PLAN_RE = /^\s*\{.*"operator".*\}\s*$/s;
const JSON_RE = /^\s*[\{\[].*[\}\]]\s*$/s;
const SQL_RE = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN|COPY|SET|BEGIN|COMMIT|ROLLBACK)\b/i;

export function peekFormat(value: string | null): FormatHint {
    if (value == null || value.length < 2) return null;
    if (PLAN_RE.test(value)) return 'plan';
    if (JSON_RE.test(value)) return 'json';
    if (SQL_RE.test(value)) return 'sql';
    return null;
}
