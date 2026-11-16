import { describe, expect, it } from 'vitest';

import { createTableSQL, insertStatements, qualifiedName, type CloudColumn } from './cloud_sql.js';
import { quoteLiteral } from '@ankoh/dashql/platform/utils/sql_quote';

const COLUMNS: CloudColumn[] = [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'note "x"', type: 'text', nullable: true },
];

describe('cloud sql', () => {
    it('quotes literals and names', () => {
        expect(quoteLiteral("it's")).toBe("'it''s'");
        expect(qualifiedName('dashql', 'a"b')).toBe('"dashql"."a""b"');
    });

    it('creates tables with the nullability of the columns', () => {
        expect(createTableSQL('"t"', COLUMNS)).toBe('CREATE TABLE "t" ("id" integer NOT NULL, "note ""x""" text)');
    });

    it('inserts the text of the values and casts it once per column', () => {
        expect([...insertStatements('"t"', COLUMNS, [['1', "it's"], ['2', null]], 1024)]).toEqual([
            `INSERT INTO "t" ("id", "note ""x""") SELECT CAST(v.c0 AS integer), CAST(v.c1 AS text) FROM (VALUES ('1', 'it''s'), ('2', NULL)) AS v(c0, c1)`,
        ]);
    });

    it('splits the rows into statements up to a length, a single row may be longer', () => {
        const rows = [['1', 'a'.repeat(10)], ['2', 'b'.repeat(10)], ['3', 'c'.repeat(200)]];
        const statements = [...insertStatements('"t"', COLUMNS, rows, 150)];
        expect(statements).toHaveLength(3);
        expect(statements[0]).toContain("('1', 'aaaaaaaaaa')");
        expect(statements[1]).toContain("('2', 'bbbbbbbbbb')");
        expect(statements[2].length).toBeGreaterThan(150);
        expect([...insertStatements('"t"', COLUMNS, [], 150)]).toEqual([]);
    });

    it('rejects rows with the wrong number of values', () => {
        expect(() => [...insertStatements('"t"', COLUMNS, [['1']], 1024)]).toThrow('Expected 2 values, found 1');
    });
});
