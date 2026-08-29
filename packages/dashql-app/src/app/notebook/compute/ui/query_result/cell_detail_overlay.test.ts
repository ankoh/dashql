import * as dashql from '../../../../../core/index.js';

import {
    detectFormats,
    detectStructuredFormats,
    structuredValueToText,
} from './cell_detail_overlay.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    dql!.resetUnsafe();
});

describe('result cell SQL formatting', () => {
    it('projects syntax highlighting against the pretty-formatted text', () => {
        const formats = detectFormats(dql, 'SELECT identifier, name FROM items WHERE identifier = 42');
        const sql = formats.sql!;

        expect(sql.formattedText).not.toBeNull();
        expect(sql.formattedUpdate).not.toBeNull();

        const text = sql.formattedText!;
        const highlightedKeywords = sql.formattedUpdate!.syntaxSpans
            .filter(span => span.tokenType === dashql.buffers.parser.ScannerTokenType.KEYWORD)
            .map(span => {
                const offset = Number(span.textSpan!.offset);
                return text.slice(offset, offset + Number(span.textSpan!.length));
            });

        expect(highlightedKeywords).toEqual(expect.arrayContaining(['select', 'from', 'where']));
        expect(sql.formattedUpdate!.syntaxSpans.every(span => {
            const range = span.textSpan;
            return range == null || Number(range.offset + range.length) <= text.length;
        })).toBe(true);
    });
});

describe('result cell structured formatting', () => {
    it('exposes Arrow list values only through the JSON viewer', () => {
        const value = [1n, null, { nested: ['value'] }];

        expect(detectStructuredFormats(value)).toEqual({
            json: value,
            sql: null,
            plan: null,
        });
    });

    it('serializes the full structured value for raw display and copying', () => {
        const value = Array.from({ length: 1000 }, (_, index) => BigInt(index));
        const text = structuredValueToText(value);

        expect(text).toContain('"0n"');
        expect(text).toContain('"999n"');
    });
});
