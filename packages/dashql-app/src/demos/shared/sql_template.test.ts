import { describe, expect, it } from 'vitest';

import { bindSqlTemplate, sqlLiteral } from './sql_template.js';

describe('SQL templates', () => {
    it('quotes strings and numbers', () => {
        expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
        expect(sqlLiteral(1.5)).toBe('1.5');
        expect(sqlLiteral(NaN)).toBe('null');
        expect(sqlLiteral(null)).toBe('null');
    });

    it('binds placeholders but leaves casts alone', () => {
        const sql = bindSqlTemplate('select x::double precision from t where s = :symbol and n > :n', { symbol: 'BTC-USD', n: 3 });
        expect(sql).toBe("select x::double precision from t where s = 'BTC-USD' and n > 3");
    });

    it('rejects a missing value', () => {
        expect(() => bindSqlTemplate('select :missing', {})).toThrow(/:missing/);
    });
});
