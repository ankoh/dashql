import * as dashql from '@akohn/dashql';

import { detectFormats } from '@akohn/dashql-react/components/query_result/cell_detail_overlay';
import { detectSqlText } from './cell_detail_overlay.js';
import { projectSqlText } from '../workbook/editor/readonly_sql_view.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    dql!.resetUnsafe();
});

describe('result cell SQL formatting', () => {
    it('highlights the pretty-formatted text', () => {
        const sql = detectSqlText(dql!, 'SELECT identifier, name FROM items WHERE identifier = 42')!;
        expect(sql.hasErrors).toBe(false);
        expect(sql.formattedText).not.toBeNull();

        const text = sql.formattedText!;
        const catalog = dql!.createCatalog();
        try {
            const update = projectSqlText(dql!, catalog, text);
            const highlightedKeywords = update.syntaxSpans
                .filter(span => span.tokenType === dashql.buffers.parser.ScannerTokenType.KEYWORD)
                .map(span => {
                    const offset = Number(span.textSpan!.offset);
                    return text.slice(offset, offset + Number(span.textSpan!.length));
                });
            expect(highlightedKeywords).toEqual(expect.arrayContaining(['select', 'from', 'where']));
            expect(update.syntaxSpans.every(span => {
                const range = span.textSpan;
                return range == null || Number(range.offset + range.length) <= text.length;
            })).toBe(true);
        } finally {
            catalog.destroy();
        }
    });

    it('does not treat JSON values as SQL', () => {
        const detectSql = (value: string) => detectSqlText(dql!, value);
        const plan = '{"tree":{"operator":"result-sink","operator-id":1,"inputs":[]}}';
        const formats = detectFormats(plan, detectSql);
        expect(formats.plan).toBe(plan);
        expect(formats.sql).toBeNull();
        expect(detectFormats('[1, 2, 3]', detectSql).sql).toBeNull();
    });

    it('reads a text that does not parse as SQL with errors', () => {
        expect(detectSqlText(dql!, 'select from where')?.hasErrors).toBe(true);
    });

    it('formats SQL previews using the selected keyword case', () => {
        const sql = detectSqlText(dql!, 'select id from items', dashql.buffers.formatting.KeywordCase.UPPER);
        expect(sql?.formattedText).toContain('SELECT id');
        expect(sql?.formattedText).toContain('FROM items');
    });
});
