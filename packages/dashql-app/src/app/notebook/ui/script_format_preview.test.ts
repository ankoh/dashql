import * as dashql from '../../../core/index.js';

import { beforeAll, describe, expect, it } from 'vitest';

import { projectFormattedText } from './script_format_preview.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('script format preview', () => {
    it('projects syntax highlighting against pretty-formatted text', () => {
        const catalog = dql.createCatalog();
        const session = dql.createScriptSession(catalog);
        let formatted: dashql.DashQLScript | null = null;
        try {
            session.replaceText(0n, 'select count(*) from items where value > 1');
            formatted = session.format(new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.HYPER,
                dashql.buffers.formatting.FormattingMode.PRETTY,
                80,
                4,
            ));
            const text = formatted.toString();
            const update = projectFormattedText(dql, text);
            const highlightedKeywords = update.syntaxSpans
                .filter(span => span.tokenType === dashql.buffers.parser.ScannerTokenType.KEYWORD)
                .map(span => text.slice(Number(span.textSpan!.offset), Number(span.textSpan!.offset + span.textSpan!.length)).toLowerCase());

            expect(highlightedKeywords).toEqual(expect.arrayContaining(['select', 'from', 'where']));
            expect(update.syntaxSpans.every(span =>
                span.textSpan != null && Number(span.textSpan.offset + span.textSpan.length) <= text.length
            )).toBe(true);
        } finally {
            formatted?.destroy();
            session.destroy();
            catalog.destroy();
        }
    });
});
